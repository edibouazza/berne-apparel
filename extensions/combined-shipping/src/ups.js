import { toCents } from "./units";

/**
 * @typedef {import("./standard").DeliveryGroup} DeliveryGroup
 * @typedef {import("./standard").Candidate} Candidate
 * @typedef {import("./config").Config} Config
 */

/**
 * UPS services: per service, keep the most expensive package's live rate and
 * take 100% off the same service in every other package. Rates are never
 * recalculated.
 *
 * With a single delivery group we can't see per-package prices, so nothing
 * is discounted.
 *
 * @param {DeliveryGroup[]} groups
 * @param {Config} config
 * @returns {Candidate[]}
 */
export function upsCandidates(groups, config) {
  if (!config.ups.enabled || groups.length < 2) return [];

  const candidates = [];
  for (const title of config.ups.titles) {
    const priced = pricedOptionsTitled(groups, title);
    if (priced === null || priced.length < 2) continue;

    let keep = priced[0];
    for (const option of priced) {
      if (option.cents > keep.cents) keep = option;
    }

    for (const option of priced) {
      if (option !== keep && option.cents > 0) {
        candidates.push({ handle: option.handle, value: { percentage: 100 } });
      }
    }
  }
  return candidates;
}

/**
 * The option with this exact title in each group that offers it. Returns null
 * if a group has the title twice or a price can't be read.
 *
 * @param {DeliveryGroup[]} groups
 * @param {string} title
 * @returns {{ handle: string, cents: number }[] | null}
 */
function pricedOptionsTitled(groups, title) {
  const priced = [];
  for (const group of groups) {
    const matches = group.deliveryOptions.filter((option) => option.title === title);
    if (matches.length > 1) return null;
    if (matches.length === 0) continue;

    const cents = toCents(matches[0].cost.amount);
    if (cents === null) return null;
    priced.push({ handle: matches[0].handle, cents });
  }
  return priced;
}
