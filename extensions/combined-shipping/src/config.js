/**
 * @typedef {Object} Band
 * @property {number | null} maxLb  Upper bound in lb; null = no upper bound.
 * @property {number} cents
 * @property {boolean} maxInclusive
 */

/**
 * @typedef {Object} Config
 * @property {boolean} enabled
 * @property {boolean} testMode
 * @property {string[]} testTags
 * @property {boolean} dryRun
 * @property {string} message
 * @property {string} currency
 * @property {string[]} countries
 * @property {number} packagingWeightLb
 * @property {{ titles: string[], bands: Band[] }} standard
 * @property {{ enabled: boolean, titles: string[] }} ups
 */

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v) =>
  Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0);
const isNonNegativeNumber = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Validates the discount's JSON config metafield. Anything unexpected returns
 * null, which the caller treats as "do nothing".
 *
 * @param {unknown} raw
 * @returns {Config | null}
 */
export function parseConfig(raw) {
  if (!isObject(raw)) return null;
  if (typeof raw.enabled !== "boolean") return null;
  if (typeof raw.testMode !== "boolean") return null;
  if (raw.testMode && !isStringArray(raw.testTags)) return null;
  if (raw.dryRun !== undefined && typeof raw.dryRun !== "boolean") return null;
  if (typeof raw.message !== "string" || raw.message.length === 0) return null;
  if (typeof raw.currency !== "string" || !/^[A-Z]{3}$/.test(raw.currency)) return null;
  if (!isStringArray(raw.countries) || raw.countries.length === 0) return null;
  if (!isNonNegativeNumber(raw.packagingWeightLb)) return null;

  const standard = parseStandard(raw.standard);
  if (!standard) return null;

  const ups = raw.ups === undefined ? { enabled: false, titles: [] } : parseUps(raw.ups);
  if (!ups) return null;

  return {
    enabled: raw.enabled,
    testMode: raw.testMode,
    testTags: raw.testTags ?? [],
    dryRun: raw.dryRun ?? false,
    message: raw.message,
    currency: raw.currency,
    countries: raw.countries,
    packagingWeightLb: raw.packagingWeightLb,
    standard,
    ups,
  };
}

function parseStandard(raw) {
  if (!isObject(raw)) return null;
  if (!isStringArray(raw.titles) || raw.titles.length === 0) return null;
  if (!Array.isArray(raw.bands) || raw.bands.length === 0) return null;

  /** @type {Band[]} */
  const bands = [];
  let previousMax = 0;
  for (let i = 0; i < raw.bands.length; i++) {
    const band = raw.bands[i];
    if (!isObject(band)) return null;
    if (!Number.isInteger(band.cents) || band.cents < 0) return null;
    if (band.maxInclusive !== undefined && typeof band.maxInclusive !== "boolean") return null;

    const isLast = i === raw.bands.length - 1;
    if (band.maxLb === null) {
      // An open-ended band only makes sense at the end.
      if (!isLast) return null;
    } else if (
      typeof band.maxLb !== "number" ||
      !Number.isFinite(band.maxLb) ||
      band.maxLb <= previousMax
    ) {
      return null;
    } else {
      previousMax = band.maxLb;
    }

    bands.push({ maxLb: band.maxLb, cents: band.cents, maxInclusive: band.maxInclusive ?? true });
  }

  return { titles: raw.titles, bands };
}

function parseUps(raw) {
  if (!isObject(raw)) return null;
  if (typeof raw.enabled !== "boolean") return null;
  if (!isStringArray(raw.titles)) return null;
  return { enabled: raw.enabled, titles: raw.titles };
}
