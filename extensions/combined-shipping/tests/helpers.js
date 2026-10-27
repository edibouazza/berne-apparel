import { expect } from "vitest";
import { cartDeliveryOptionsDiscountsGenerateRun } from "../src";

export const UPS_2ND_DAY = "UPS 2nd Day Air®";
export const UPS_3_DAY = "UPS 3 Day Select®";
export const UPS_NEXT_DAY = "UPS Next Day Air®";

/** The settled config from the spec, with testTags as a list for the input query variable. */
export const CONFIG = Object.freeze({
  enabled: true,
  testMode: true,
  testTags: ["combined-shipping-test"],
  message: "Combined shipping",
  currency: "USD",
  countries: ["US"],
  packagingWeightLb: 0,
  standard: {
    titles: ["Standard Shipping"],
    bands: [
      { maxLb: 1, cents: 499, maxInclusive: false },
      { maxLb: 3, cents: 999, maxInclusive: true },
      { maxLb: 5, cents: 1199, maxInclusive: true },
      { maxLb: 8, cents: 1499, maxInclusive: true },
      { maxLb: null, cents: 1799 },
    ],
  },
  ups: {
    enabled: false,
    titles: [UPS_2ND_DAY, UPS_3_DAY, UPS_NEXT_DAY],
  },
});

export const withConfig = (overrides) => ({ ...structuredClone(CONFIG), ...overrides });

export const option = (handle, title, amount, currencyCode = "USD") => ({
  handle,
  title,
  cost: { amount, currencyCode },
});

export const line = (weight, weightUnit = "POUNDS", { quantity = 1, requiresShipping = true } = {}) => ({
  quantity,
  merchandise: { __typename: "ProductVariant", weight, weightUnit, requiresShipping },
});

let groupCounter = 0;
export const group = ({ options, lines, countryCode = "US" }) => ({
  id: `gid://shopify/CartDeliveryGroup/${++groupCounter}`,
  deliveryAddress: { countryCode },
  deliveryOptions: options,
  cartLines: lines,
});

/** A group with just a Standard Shipping option. */
export const standardGroup = (handle, amount, lines, extraOptions = []) =>
  group({ options: [option(handle, "Standard Shipping", amount), ...extraOptions], lines });

export const input = ({
  groups,
  config = CONFIG,
  tagged = true,
  discountClasses = ["SHIPPING"],
}) => ({
  cart: {
    buyerIdentity: { customer: { hasAnyTag: tagged } },
    deliveryGroups: groups,
  },
  discount: {
    discountClasses,
    metafield: { jsonValue: config },
  },
});

const toCents = (amount) => Math.round(Number(amount) * 100);

/**
 * Runs the function and checks the non-negotiable invariant on every
 * candidate: each discount is >= 0 and <= the targeted option's cost.
 */
export function run(runInput) {
  const output = cartDeliveryOptionsDiscountsGenerateRun(runInput);
  const optionsByHandle = new Map(
    runInput.cart.deliveryGroups.flatMap((g) => g.deliveryOptions.map((o) => [o.handle, o])),
  );

  for (const operation of output.operations) {
    const add = operation.deliveryDiscountsAdd;
    expect(add.selectionStrategy).toBe("ALL");
    for (const candidate of add.candidates) {
      expect(candidate.targets).toHaveLength(1);
      const targeted = optionsByHandle.get(candidate.targets[0].deliveryOption.handle);
      expect(targeted, "candidate targets an unknown option").toBeDefined();

      if (candidate.value.fixedAmount) {
        const cents = toCents(candidate.value.fixedAmount.amount);
        expect(cents).toBeGreaterThan(0);
        expect(cents).toBeLessThanOrEqual(toCents(targeted.cost.amount));
      } else {
        expect(candidate.value.percentage.value).toBeGreaterThan(0);
        expect(candidate.value.percentage.value).toBeLessThanOrEqual(100);
      }
    }
  }
  return output;
}

/** Discount in cents per targeted handle. */
export function discountsByHandle(runInput, output) {
  const optionsByHandle = new Map(
    runInput.cart.deliveryGroups.flatMap((g) => g.deliveryOptions.map((o) => [o.handle, o])),
  );
  const result = {};
  for (const operation of output.operations) {
    for (const candidate of operation.deliveryDiscountsAdd.candidates) {
      const handle = candidate.targets[0].deliveryOption.handle;
      const cost = toCents(optionsByHandle.get(handle).cost.amount);
      const cents = candidate.value.fixedAmount
        ? toCents(candidate.value.fixedAmount.amount)
        : Math.round((cost * candidate.value.percentage.value) / 100);
      result[handle] = (result[handle] ?? 0) + cents;
    }
  }
  return result;
}

/** What the customer pays, in cents, when they pick `title` in every group. */
export function paidFor(runInput, output, title) {
  const discounts = discountsByHandle(runInput, output);
  return runInput.cart.deliveryGroups.reduce((total, g) => {
    const chosen = g.deliveryOptions.find((o) => o.title === title);
    const cost = toCents(chosen.cost.amount);
    return total + cost - Math.min(cost, discounts[chosen.handle] ?? 0);
  }, 0);
}
