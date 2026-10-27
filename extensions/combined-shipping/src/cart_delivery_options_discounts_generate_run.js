import {
  DeliveryDiscountSelectionStrategy,
  DiscountClass,
} from "../generated/api";
import { parseConfig } from "./config";
import { standardCandidates } from "./standard";
import { upsCandidates } from "./ups";
import { centsToDecimal } from "./units";

/**
  * @typedef {import("../generated/api").DeliveryInput} RunInput
  * @typedef {import("../generated/api").CartDeliveryOptionsDiscountsGenerateRunResult} CartDeliveryOptionsDiscountsGenerateRunResult
  * @typedef {import("./standard").Candidate} Candidate
  * @typedef {import("./config").Config} Config
  */

/** @type {CartDeliveryOptionsDiscountsGenerateRunResult} */
const NO_OPERATIONS = { operations: [] };

/**
  * Fails open: any unexpected input or error means no discount, so checkout
  * falls back to normal Shopify pricing.
  *
  * @param {RunInput} input
  * @returns {CartDeliveryOptionsDiscountsGenerateRunResult}
  */
export function cartDeliveryOptionsDiscountsGenerateRun(input) {
  try {
    return run(input);
  } catch (error) {
    console.error(`combined-shipping: failing open after error: ${error}`);
    return NO_OPERATIONS;
  }
}

/**
  * @param {RunInput} input
  * @returns {CartDeliveryOptionsDiscountsGenerateRunResult}
  */
function run(input) {
  if (!input.discount.discountClasses.includes(DiscountClass.Shipping)) return NO_OPERATIONS;

  const config = parseConfig(input.discount.metafield?.jsonValue);
  if (!config || !config.enabled) return NO_OPERATIONS;

  // hasAnyTag is resolved against config.testTags via the input query variables.
  if (config.testMode && input.cart.buyerIdentity?.customer?.hasAnyTag !== true) {
    return NO_OPERATIONS;
  }

  const groups = input.cart.deliveryGroups;
  if (groups.length === 0) return NO_OPERATIONS;

  const inScope = groups.every(
    (group) =>
      config.countries.includes(group.deliveryAddress?.countryCode ?? "") &&
      group.deliveryOptions.every((option) => option.cost.currencyCode === config.currency),
  );
  if (!inScope) return NO_OPERATIONS;

  const candidates = [...standardCandidates(groups, config), ...upsCandidates(groups, config)];
  if (candidates.length === 0) return NO_OPERATIONS;

  if (config.dryRun) {
    console.error(`combined-shipping dry run: ${JSON.stringify(candidates)}`);
    return NO_OPERATIONS;
  }

  return {
    operations: [
      {
        deliveryDiscountsAdd: {
          candidates: candidates.map((candidate) => toDiscountCandidate(candidate, config)),
          selectionStrategy: DeliveryDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}

/**
  * @param {Candidate} candidate
  * @param {Config} config
  */
function toDiscountCandidate(candidate, config) {
  const value =
    "fixedAmountCents" in candidate.value
      ? { fixedAmount: { amount: centsToDecimal(candidate.value.fixedAmountCents) } }
      : { percentage: { value: candidate.value.percentage } };

  return {
    message: config.message,
    targets: [{ deliveryOption: { handle: candidate.handle } }],
    value,
  };
}
