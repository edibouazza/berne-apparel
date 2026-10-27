#!/usr/bin/env node
// READ-ONLY. Lists every active discount and whether it combines with
// shipping discounts. A product or order discount that doesn't allow shipping
// discounts can knock "Combined shipping" out of a checkout when it applies.
//
//   npm run audit-discounts -- [--json]
//
// This script only runs queries. It never changes a discount.

import { parseArgs } from "node:util";
import { adminClient } from "./lib/admin.mjs";

const { values: args } = parseArgs({ options: { json: { type: "boolean", default: false } } });

const COMMON = `title status discountClasses combinesWith { productDiscounts orderDiscounts shippingDiscounts }`;
const CODES = `codesCount { count } codes(first: 3) { nodes { code } }`;

const ACTIVE_DISCOUNTS = `#graphql
  query ActiveDiscounts($after: String) {
    discountNodes(first: 100, after: $after, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        discount {
          __typename
          ... on DiscountAutomaticApp { ${COMMON} }
          ... on DiscountAutomaticBasic { ${COMMON} }
          ... on DiscountAutomaticBxgy { ${COMMON} }
          ... on DiscountAutomaticFreeShipping { ${COMMON} }
          ... on DiscountCodeApp { ${COMMON} ${CODES} }
          ... on DiscountCodeBasic { ${COMMON} ${CODES} }
          ... on DiscountCodeBxgy { ${COMMON} ${CODES} }
          ... on DiscountCodeFreeShipping { ${COMMON} ${CODES} }
        }
      }
    }
  }
`;

const graphql = await adminClient();
const rows = [];
let after = null;
do {
  const { discountNodes: page } = await graphql(ACTIVE_DISCOUNTS, { after });
  for (const { id, discount } of page.nodes) {
    const classes = discount.discountClasses ?? [];
    const isShipping = classes.includes("SHIPPING");
    const blocksUs = !isShipping && discount.combinesWith?.shippingDiscounts === false;
    rows.push({
      id,
      type: discount.__typename,
      method: discount.__typename.startsWith("DiscountCode") ? "code" : "automatic",
      title: discount.title,
      codes: discount.codes?.nodes.map((n) => n.code) ?? [],
      codesCount: discount.codesCount?.count ?? 0,
      classes,
      combinesWithShipping: discount.combinesWith?.shippingDiscounts ?? null,
      note: blocksUs
        ? "Does not combine with shipping discounts: can knock out Combined shipping"
        : isShipping
          ? "Shipping discount: competes with Combined shipping, the better one wins"
          : "",
    });
  }
  after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
} while (after);

if (args.json) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.table(
    rows.map((r) => ({
      method: r.method,
      title: r.title,
      codes: r.codesCount > 3 ? `${r.codes.join(", ")} (+${r.codesCount - 3})` : r.codes.join(", "),
      classes: r.classes.join(","),
      "combines w/ shipping": r.combinesWithShipping,
      note: r.note,
    })),
  );
  const blocking = rows.filter((r) => r.note.startsWith("Does not combine"));
  console.log(`\n${rows.length} active discounts, ${blocking.length} block shipping discounts.`);
}
