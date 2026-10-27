import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const API_VERSION = "2026-10";
export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Scripts are top-level await; print failures as one line instead of a stack.
process.on("uncaughtException", (error) => {
  console.error(error.message);
  process.exit(1);
});

/** client_id from shopify.app.toml, used to recognise this app's discounts. */
export function appClientId() {
  const toml = readFileSync(new URL("../../shopify.app.toml", import.meta.url), "utf8");
  const match = /^client_id\s*=\s*"([^"]+)"/m.exec(toml);
  if (!match) throw new Error("client_id not found in shopify.app.toml");
  return match[1];
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See README → Scripts.`);
  return value;
}

/**
 * The Admin API token must belong to this app: Shopify only lets the app that
 * owns a function create discounts for it.
 *
 * SHOPIFY_ADMIN_TOKEN wins if set. Otherwise SHOPIFY_CLIENT_SECRET is
 * exchanged with the client credentials grant, which works when the store and
 * the app belong to the same organization.
 */
async function accessToken(shop) {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID ?? appClientId(),
      client_secret: requireEnv("SHOPIFY_CLIENT_SECRET"),
    }),
  });
  if (!response.ok) {
    throw new Error(`Client credentials grant failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()).access_token;
}

export async function adminClient() {
  const shop = requireEnv("SHOPIFY_STORE");
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) {
    throw new Error(`SHOPIFY_STORE must be the myshopify.com domain, got "${shop}"`);
  }
  const token = await accessToken(shop);

  return async function graphql(query, variables = {}) {
    const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`Admin API ${response.status}: ${await response.text()}`);
    }
    const body = await response.json();
    if (body.errors?.length) {
      throw new Error(`Admin API errors: ${JSON.stringify(body.errors, null, 2)}`);
    }
    return body.data;
  };
}

export function assertNoUserErrors(payload, label) {
  if (payload?.userErrors?.length) {
    throw new Error(`${label} failed: ${JSON.stringify(payload.userErrors, null, 2)}`);
  }
}
