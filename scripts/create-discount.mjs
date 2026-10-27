#!/usr/bin/env node
// Creates or updates the "Combined shipping" automatic app discount and its
// config metafield.
//
//   npm run create-discount -- [--config config/combined-shipping.json] [--dry-run] [--go-live]
//
// Refuses to push testMode: false unless --go-live is passed.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseConfig } from "../extensions/combined-shipping/src/config.js";
import { ROOT, adminClient, appClientId, assertNoUserErrors } from "./lib/admin.mjs";

const TITLE = "Combined shipping";
const FUNCTION_HANDLE = "combined-shipping";
const METAFIELD = { namespace: "$app:combined-shipping", key: "config", type: "json" };
const DISCOUNT_SETTINGS = {
  title: TITLE,
  discountClasses: ["SHIPPING"],
  combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: false },
};

const { values: args } = parseArgs({
  options: {
    config: { type: "string", default: path.join(ROOT, "config/combined-shipping.json") },
    "dry-run": { type: "boolean", default: false },
    "go-live": { type: "boolean", default: false },
  },
});

const rawConfig = JSON.parse(readFileSync(args.config, "utf8"));
const config = parseConfig(rawConfig);
if (!config) {
  console.error(`${args.config} is not a valid config. The function would ignore it.`);
  process.exit(1);
}
if (!config.testMode && !args["go-live"]) {
  console.error("Config has testMode: false. Re-run with --go-live once QA has signed off.");
  process.exit(1);
}

const FIND_DISCOUNTS = `#graphql
  query FindDiscounts($after: String) {
    automaticDiscountNodes(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        automaticDiscount {
          __typename
          ... on DiscountAutomaticApp {
            title
            status
            appDiscountType { appKey }
          }
        }
      }
    }
  }
`;

const CREATE = `#graphql
  mutation CreateDiscount($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId title status }
      userErrors { field message }
    }
  }
`;

const UPDATE = `#graphql
  mutation UpdateDiscount($id: ID!, $discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId title status }
      userErrors { field message }
    }
  }
`;

const SET_CONFIG = `#graphql
  mutation SetConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { namespace key }
      userErrors { field message }
    }
  }
`;

async function findExisting(graphql, clientId) {
  const matches = [];
  let after = null;
  do {
    const { automaticDiscountNodes: page } = await graphql(FIND_DISCOUNTS, { after });
    for (const node of page.nodes) {
      const discount = node.automaticDiscount;
      if (
        discount.__typename === "DiscountAutomaticApp" &&
        discount.title === TITLE &&
        discount.appDiscountType.appKey === clientId
      ) {
        matches.push({ id: node.id, status: discount.status });
      }
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  if (matches.length > 1) {
    throw new Error(`Found ${matches.length} "${TITLE}" discounts from this app; resolve manually.`);
  }
  return matches[0] ?? null;
}

const graphql = await adminClient();
const existing = await findExisting(graphql, appClientId());
const value = JSON.stringify(rawConfig);

console.log(
  existing
    ? `Updating ${existing.id} (${existing.status})`
    : `Creating automatic discount "${TITLE}"`,
);
console.log(`testMode: ${config.testMode}, enabled: ${config.enabled}, ups.enabled: ${config.ups.enabled}`);

if (args["dry-run"]) {
  console.log("Dry run: no changes made.");
  process.exit(0);
}

if (existing) {
  const { discountAutomaticAppUpdate } = await graphql(UPDATE, {
    id: existing.id,
    discount: DISCOUNT_SETTINGS,
  });
  assertNoUserErrors(discountAutomaticAppUpdate, "discountAutomaticAppUpdate");

  const { metafieldsSet } = await graphql(SET_CONFIG, {
    metafields: [{ ...METAFIELD, ownerId: existing.id, value }],
  });
  assertNoUserErrors(metafieldsSet, "metafieldsSet");
  console.log(`Updated ${existing.id}`);
} else {
  const { discountAutomaticAppCreate } = await graphql(CREATE, {
    discount: {
      ...DISCOUNT_SETTINGS,
      functionHandle: FUNCTION_HANDLE,
      startsAt: new Date().toISOString(),
      metafields: [{ ...METAFIELD, value }],
    },
  });
  assertNoUserErrors(discountAutomaticAppCreate, "discountAutomaticAppCreate");
  console.log(`Created ${discountAutomaticAppCreate.automaticAppDiscount.discountId}`);
}
