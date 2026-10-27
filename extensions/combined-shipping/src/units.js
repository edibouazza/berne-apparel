const LB_PER_UNIT = {
  GRAMS: 1 / 453.59237,
  KILOGRAMS: 2.20462262,
  OUNCES: 1 / 16,
  POUNDS: 1,
};

/**
 * Converts a Decimal money amount ("4.99" or 4.99) to integer cents.
 * Returns null for anything that isn't a non-negative amount with at most
 * two decimal places.
 *
 * @param {unknown} amount
 * @returns {number | null}
 */
export function toCents(amount) {
  const text = typeof amount === "number" ? String(amount) : amount;
  if (typeof text !== "string") return null;

  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;

  const [, whole, fraction = ""] = match;
  // Shopify Decimals can carry trailing zeros ("4.990"); anything beyond cents must be zero.
  if (/[1-9]/.test(fraction.slice(2))) return null;

  return Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
}

/**
 * @param {number} cents
 * @returns {number}
 */
export function centsToDecimal(cents) {
  return Number((cents / 100).toFixed(2));
}

/**
 * Converts a weight to pounds. Returns null for an unknown unit or a weight
 * that is missing, zero, or negative.
 *
 * @param {unknown} weight
 * @param {unknown} unit
 * @returns {number | null}
 */
export function toPounds(weight, unit) {
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) return null;
  if (typeof unit !== "string" || !Object.prototype.hasOwnProperty.call(LB_PER_UNIT, unit)) return null;
  return weight * LB_PER_UNIT[unit];
}

/**
 * Rounds away floating-point noise from unit conversion so totals that are
 * exactly on a band boundary (e.g. 48 oz + 0 g = 3 lb) compare as equal.
 *
 * @param {number} lb
 * @returns {number}
 */
export function roundPounds(lb) {
  return Math.round(lb * 1e4) / 1e4;
}
