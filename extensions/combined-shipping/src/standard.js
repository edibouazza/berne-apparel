import { roundPounds, toCents, toPounds } from "./units";

/**
 * @typedef {import("../generated/api").DeliveryInput["cart"]["deliveryGroups"][number]} DeliveryGroup
 * @typedef {import("./config").Config} Config
 * @typedef {import("./config").Band} Band
 * @typedef {{ handle: string, value: { fixedAmountCents: number } | { percentage: number } }} Candidate
 */

/**
 * Standard Shipping: the customer pays the band for the whole cart's weight,
 * as if it shipped as one package, but never more than Shopify already charges.
 * The overage is discounted back off the Standard option in each group.
 *
 * On a single-location cart the charge already equals the band, so this
 * returns nothing without needing to know whether the cart split.
 *
 * @param {DeliveryGroup[]} groups
 * @param {Config} config
 * @returns {Candidate[]}
 */
export function standardCandidates(groups, config) {
  const shippingGroups = groups.filter((group) =>
    group.cartLines.some((line) => line.merchandise.requiresShipping === true),
  );
  if (shippingGroups.length === 0) return [];

  const options = [];
  for (const group of shippingGroups) {
    // Exact title match: "Free Standard Shipping" must never match "Standard Shipping".
    const matches = group.deliveryOptions.filter(
      (option) => option.title != null && config.standard.titles.includes(option.title),
    );
    if (matches.length !== 1) return [];

    const cents = toCents(matches[0].cost.amount);
    // An option that is already free means there's nothing to take back.
    if (cents === null || cents === 0) return [];
    options.push({ handle: matches[0].handle, cents });
  }

  const weightLb = cartWeightLb(shippingGroups, config.packagingWeightLb);
  if (weightLb === null) return [];

  const bandCents = bandFor(weightLb, config.standard.bands);
  if (bandCents === null) return [];

  const charged = options.reduce((total, option) => total + option.cents, 0);
  let remaining = charged - Math.min(charged, bandCents);
  if (remaining <= 0) return [];

  // Smallest option first, so the discount zeroes out whole packages before
  // touching the larger one. Each take is capped at the option's own cost.
  const candidates = [];
  for (const option of [...options].sort((a, b) => a.cents - b.cents)) {
    const take = Math.min(option.cents, remaining);
    if (take > 0) {
      candidates.push({ handle: option.handle, value: { fixedAmountCents: take } });
      remaining -= take;
    }
    if (remaining === 0) break;
  }
  return candidates;
}

/**
 * Total weight in lb of every line that requires shipping, plus packaging.
 * Returns null if any shipping line is missing a usable weight.
 *
 * @param {DeliveryGroup[]} groups
 * @param {number} packagingWeightLb
 * @returns {number | null}
 */
export function cartWeightLb(groups, packagingWeightLb) {
  let total = packagingWeightLb;
  for (const group of groups) {
    for (const line of group.cartLines) {
      const { requiresShipping, weight, weightUnit } = line.merchandise;
      if (typeof requiresShipping !== "boolean") return null;
      if (!requiresShipping) continue;
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) return null;

      const lb = toPounds(weight, weightUnit);
      if (lb === null) return null;
      total += lb * line.quantity;
    }
  }
  return roundPounds(total);
}

/**
 * Bands are validated as ascending, with an optional open-ended last band.
 *
 * @param {number} weightLb
 * @param {Band[]} bands
 * @returns {number | null}
 */
export function bandFor(weightLb, bands) {
  for (const band of bands) {
    if (band.maxLb === null) return band.cents;
    if (band.maxInclusive ? weightLb <= band.maxLb : weightLb < band.maxLb) return band.cents;
  }
  return null;
}
