# Berne Combined Shipping

A Shopify Discount Function (shipping class) that stops split shipments from charging shipping two or three times.

Berne ships from several locations (ShipBob Fort Worth, Ossian, Ontario). When a cart ships from more than one, Shopify rates each package separately and adds the rates together. Functions can't set shipping rates, so this app lets Shopify rate the cart as usual, then discounts the overcharge back off. Rates, option names, handles and the manual estimated delivery dates are never touched.

## Rules

**Standard Shipping.** The customer pays the band for the **total cart weight**, as if it shipped as one package, and never more than Shopify already charges:

```
final = min(charged, band(totalWeight))
```

| Total weight | Price |
|---|---|
| under 1 lb | $4.99 |
| 1–3 lb | $9.99 |
| over 3 – 5 lb | $11.99 |
| over 5 – 8 lb | $14.99 |
| over 8 lb | $17.99 |

- The overage is taken off the Standard option in each package, smallest first, never more than that option's cost.
- Two 0.9 lb boxes rate $4.99 + $4.99 = $9.98. The 1.8 lb band is $9.99, so nothing changes.
- Single-location carts come out unchanged: the charge already equals the band.
- Titles match exactly. `Free Standard Shipping` is never targeted.
- If any Standard option is already $0, nothing happens.

**UPS services** (off until the spike confirms one delivery group per location). For each service, the most expensive package keeps its live UPS rate and the same service in every other package gets 100% off. Rates are never recalculated. With one merged delivery group there's nothing to compare, so nothing happens.

**Fail open.** Missing weight, unknown unit, wrong currency, non-US address, a missing or ambiguous option, bad config, or any error: the function returns no operations and checkout uses normal Shopify pricing. It never throws, and every discount is between $0 and the option's cost. Money math is done in integer cents.

## Layout

```
shopify.app.toml                      App config (client_id, write_discounts scope)
config/combined-shipping.json         Source of truth for the discount's config metafield
extensions/combined-shipping/
  shopify.extension.toml              Delivery-options target only (cart.delivery-options.discounts.generate.run)
  src/
    cart_delivery_options_discounts_generate_run.graphql   Input query
    cart_delivery_options_discounts_generate_run.js        Entry point: gating, fail-open, output
    config.js                          Config validation
    standard.js                        Standard Shipping band logic
    ups.js                             UPS logic
    units.js                           Cents and weight conversion
  tests/
    combined-shipping.test.js          Unit tests (every case in the spec + invariant checks)
    fixtures.test.js                   Runs every fixture through the compiled wasm
    fixtures/synthetic/                Hand-built fixtures
    fixtures/                          Put real fixtures from the spike here
scripts/
  create-discount.mjs                  Create or update the automatic discount + metafield
  audit-discounts.mjs                  Read-only report of active discounts vs shipping combinability
```

## Config

The config lives in a JSON metafield on the discount: namespace `$app:combined-shipping`, key `config`. Edit [config/combined-shipping.json](config/combined-shipping.json) and push it with `npm run create-discount`. The same metafield also supplies the `$testTags` input query variable.

| Field | Meaning |
|---|---|
| `enabled` | Kill switch. `false` → the function does nothing. |
| `testMode` | `true` → only applies to customers tagged with one of `testTags`. |
| `testTags` | Customer tags that count as testers. A list, because it feeds the input query's `hasAnyTag(tags:)` argument. |
| `dryRun` | Optional. `true` → computes discounts and logs them to the function run log, but applies nothing. |
| `message` | Discount label shown at checkout (`Combined shipping`). |
| `currency` | Every delivery option must be in this currency, or nothing happens. |
| `countries` | Every delivery address must be in this list, or nothing happens. |
| `packagingWeightLb` | Added once per cart to the total weight. `0` because the default package (Shipping Bag) is 0 lb. |
| `standard.titles` | Exact option titles treated as Standard Shipping. |
| `standard.bands` | Ascending `maxLb` bands with prices in integer `cents`. `maxInclusive: false` means "under"; it defaults to `true`. A `maxLb: null` band catches everything above, and must be last. |
| `ups.enabled` | Turns the UPS rule on. Leave `false` until the spike says it's possible. |
| `ups.titles` | Exact UPS option titles as they appear in the function input. |

Two changes from the original spec: `testTag` became `testTags` (a list) so it can drive the input query variable instead of being hard-coded in the query, and `dryRun` was added for the spike.

### Kill switch

Set `"enabled": false` in the config and run `npm run create-discount`. The function stops applying on the next checkout. To remove it entirely, deactivate the **Combined shipping** discount in **Shopify admin → Discounts**.

## Development

Requires Node 22+ and Shopify CLI 4.9+.

```bash
npm install
```

Run the unit and fixture tests:

```bash
npm test
```

Build the function to `extensions/combined-shipping/dist/function.wasm`:

```bash
npm run build
```

Run one fixture through the CLI. The `--input` file is the fixture's `payload.input`:

```bash
shopify app function run --path extensions/combined-shipping --export cart-delivery-options-discounts-generate-run --input input.json
```

Instruction counts on the synthetic fixtures are 0.85M–1.44M against the 11M limit (`npm test` prints them).

## Scripts

Both scripts call the Admin API with **this app's** credentials. Shopify only lets the app that owns a function create discounts for it, so a token from another app or from `shopify store auth` won't work for `create-discount`.

Environment:

- `SHOPIFY_STORE`: the store's `*.myshopify.com` domain.
- Either `SHOPIFY_ADMIN_TOKEN`: an Admin API access token for this app on the store,
- or `SHOPIFY_CLIENT_SECRET`: the app's client secret from the Dev Dashboard. The script exchanges it with the client credentials grant. This only works when the store and the app belong to the same organization. `SHOPIFY_CLIENT_ID` defaults to the `client_id` in `shopify.app.toml`.

```bash
npm run create-discount -- --dry-run
```

```bash
npm run create-discount
```

`create-discount` finds this app's automatic discount titled `Combined shipping`. If none exists, it creates one with `discountAutomaticAppCreate`. If one exists, it updates it with `discountAutomaticAppUpdate` and `metafieldsSet`. Either way it sets the metafield from `config/combined-shipping.json`, `discountClasses: [SHIPPING]`, and `combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: false }`. It refuses invalid config, and refuses `testMode: false` unless you pass `--go-live`.

```bash
npm run audit-discounts
```

`audit-discounts` is read-only. It lists every active discount and whether it combines with shipping discounts. Rows marked "can knock out Combined shipping" are product or order discounts that don't allow shipping discounts. When one applies, ours can be dropped. Add `--json` for raw output. It never changes a discount.

## Deploying

1. In the Dev Dashboard, set **Berne Combined Shipping** to custom distribution for the Berne store and install it from the generated link.
2. Deploy the app version:

   ```bash
   npm run deploy
   ```

3. Create the discount with `testMode: true`:

   ```bash
   npm run create-discount
   ```

4. Tag a test customer `combined-shipping-test`.

## Phase 0 spike

The spike confirms how real carts look before anything applies to customers.

1. Set `"dryRun": true` in the config and push it. The function applies nothing and logs the discounts it would have applied.
2. As the tagged test customer, check out:
   - Fort Worth only, Ossian only, Fort Worth + Ossian
   - a 3-way cart, if inventory allows
   - any one of them with a UPS service selected
   - a split cart over $100 where each location's share is under $100. Check that `Free Standard Shipping` still appears. If it doesn't, that's native shipping config, not this function.
3. Pull each run's input from **Dev Dashboard → Berne Combined Shipping → Logs** (or `shopify app logs`). Save them in the fixture format (see `tests/fixtures/synthetic/`) in `extensions/combined-shipping/tests/fixtures/`. `npm test` picks them up automatically.
4. Confirm from the logged inputs:
   - whether a split cart has one `deliveryGroup` per location, or one merged group
   - the exact option titles (`®` placement, carrier prefix) and update `standard.titles` / `ups.titles`
   - that `weight` and `weightUnit` arrive on every line
   - that `band(weight)` reproduces each single-location cart's Standard price, including at exactly 1, 3, 5 and 8 lb. If prices are about 0.41 lb off, the Standard Box is in play and `packagingWeightLb` needs adjusting.
5. UPS is only possible with one delivery group per location and per-group UPS costs. If carts come back as one merged group, leave `ups.enabled: false`.

## Going live

1. Set `"dryRun": false` and push. The discount now applies, but only to tagged testers.
2. Run the [QA checklist](#manual-qa-checklist) as a tagged customer.
3. After sign-off, set `"testMode": false` and push with `npm run create-discount -- --go-live`.

## Rolling back

- **Fastest:** set `"enabled": false` and run `npm run create-discount` (add `--go-live` if `testMode` is already `false`).
- **Back to testers only:** set `"testMode": true` and push.
- **Remove:** deactivate the Combined shipping discount in Shopify admin.
- **Bad function code:** redeploy the previous app version from the Dev Dashboard (Versions → release).

Shipping rates, profiles and delivery options are never changed, so there's nothing else to undo.

## Known behaviour

- Standard's discount assumes Standard is chosen in every package. If a customer picks Standard in one package and a different service in another, part of the discount can land on the Standard package they kept. They still never pay more than Shopify's own price.
- Only one shipping discount applies per checkout (`shippingDiscounts: false`). If a free-shipping or "$X off shipping" code is entered, Shopify keeps whichever is better for the customer.
- `Free Standard Shipping` appearing (or not) on split carts over $100 is native shipping config. This function never targets it.

## Manual QA checklist

Run as a customer tagged `combined-shipping-test` while `testMode` is `true`. For each checkout, note the shipping line, the "Combined shipping" discount, and the total.

**Standard Shipping**

- [ ] Single location (Fort Worth only, Ossian only): no Combined shipping discount, price unchanged
- [ ] 2-way split, overage: total Standard equals the band for the combined weight
- [ ] 3-way split: total Standard equals the band, and no package goes below $0
- [ ] Two light items (e.g. 0.9 lb + 0.9 lb) split: no discount ($9.98 < $9.99)
- [ ] Carts at exactly 1, 3, 5 and 8 lb total, and just above each: correct band
- [ ] A cart where Standard is already $0: no discount
- [ ] Split cart over $100: `Free Standard Shipping` untouched; picking it costs $0 with no extra charge
- [ ] Cart with items in different weight units: correct band
- [ ] A product with no weight: no discount (normal pricing)
- [ ] A non-shipping item (e.g. gift card) in the cart: ignored in weight
- [ ] Non-US address: no discount
- [ ] Untagged customer (or logged out): no discount
- [ ] `enabled: false`: no discount

**UPS** (only once `ups.enabled` is on)

- [ ] 2-way split, UPS service selected: highest package rate kept, other package's same service $0
- [ ] 3-way split: same, across all three
- [ ] Single location with UPS: unchanged

**Payment methods** (each on a split cart)

- [ ] Regular checkout
- [ ] Shop Pay
- [ ] Apple Pay
- [ ] Google Pay
- [ ] PayPal express

**Delivery options**

- [ ] Manual estimated delivery dates still show on every option
- [ ] Option names and order unchanged

**Combining with other discounts** (run `npm run audit-discounts` first)

- [ ] Free-shipping code on a split cart: free wins, no extra charge
- [ ] "$X off shipping" code on a split cart: only one shipping discount applies, and it's the better one for the customer
- [ ] Product or order code on a split cart: Combined shipping still applies
- [ ] Any code flagged by the audit as not combining with shipping: confirm what happens and decide whether to change it (the scripts never edit discounts)
