#!/usr/bin/env node
// Gets an offline Admin API token for this app on a store outside the app's
// organization, where the client credentials grant isn't allowed. The app has
// no backend, so the OAuth redirect is copied back by hand.
//
//   npm run get-token                          Print the URL to approve in the store admin
//   npm run get-token -- "<redirected URL>"    Exchange the code for a token
//
// Needs SHOPIFY_STORE and SHOPIFY_CLIENT_SECRET.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { appClientId } from "./lib/admin.mjs";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See README → Scripts.`);
  return value;
}

const toml = readFileSync(new URL("../shopify.app.toml", import.meta.url), "utf8");
const scopes = /^scopes\s*=\s*"([^"]*)"/m.exec(toml)?.[1];
const redirectUri = /^redirect_urls\s*=\s*\[\s*"([^"]+)"/m.exec(toml)?.[1];
if (!scopes || !redirectUri) throw new Error("scopes or redirect_urls not found in shopify.app.toml");

const clientId = process.env.SHOPIFY_CLIENT_ID ?? appClientId();
const shop = requireEnv("SHOPIFY_STORE");
const secret = requireEnv("SHOPIFY_CLIENT_SECRET");
const redirected = process.argv[2];

if (!redirected) {
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state: randomBytes(12).toString("hex"),
  });
  console.log("1. Open this while signed in to the store admin and approve:\n");
  console.log(`   ${url}\n`);
  console.log("2. The browser lands on a shopify.dev page. Copy the full address bar URL and run:\n");
  console.log('   npm run get-token -- "<that URL>"');
  process.exit(0);
}

const params = new URL(redirected).searchParams;
if (params.get("shop") !== shop) {
  throw new Error(`Redirect is for ${params.get("shop")}, expected ${shop}`);
}

// Shopify signs the redirect: HMAC-SHA256 of the other params, sorted.
const hmac = params.get("hmac") ?? "";
const message = [...params]
  .filter(([key]) => key !== "hmac")
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => `${key}=${value}`)
  .join("&");
const expected = createHmac("sha256", secret).update(message).digest("hex");
if (hmac.length !== expected.length || !timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
  throw new Error("HMAC check failed: the URL wasn't signed with this app's secret.");
}

const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_id: clientId, client_secret: secret, code: params.get("code") }),
});
if (!response.ok) {
  throw new Error(`Code exchange failed (${response.status}): ${await response.text()}`);
}
const { access_token: token, scope } = await response.json();
// Each code works once, so save the token before anything else can fail.
const envFile = new URL("../.env", import.meta.url);
const kept = existsSync(envFile)
  ? readFileSync(envFile, "utf8")
      .split("\n")
      .filter((line) => line && !/^(SHOPIFY_STORE|SHOPIFY_ADMIN_TOKEN)=/.test(line))
  : [];
const lines = [...kept, `SHOPIFY_STORE=${shop}`, `SHOPIFY_ADMIN_TOKEN=${token}`];
writeFileSync(envFile, `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(`Saved SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN to .env (gitignored). Granted scopes: ${scope}`);
