import { describe, expect, test } from "vitest";
import { cartDeliveryOptionsDiscountsGenerateRun } from "../src";
import {
  CONFIG,
  UPS_2ND_DAY,
  UPS_3_DAY,
  UPS_NEXT_DAY,
  discountsByHandle,
  group,
  input,
  line,
  option,
  paidFor,
  run,
  standardGroup,
  withConfig,
} from "./helpers";

const NO_OPS = { operations: [] };
const UPS_ON = withConfig({ ups: { ...CONFIG.ups, enabled: true } });

describe("Standard Shipping", () => {
  test("single location → no ops", () => {
    const i = input({ groups: [standardGroup("fw-std", "9.99", [line(2)])] });
    expect(run(i)).toEqual(NO_OPS);
  });

  test("2-way split with overage → discount brings total to band", () => {
    const i = input({
      groups: [
        standardGroup("fw-std", "9.99", [line(2)]),
        standardGroup("os-std", "4.99", [line(0.5)]),
      ],
    });
    const output = run(i);

    // 2.5 lb → $9.99 band. Charged $14.98, so $4.99 comes off the smaller option.
    expect(discountsByHandle(i, output)).toEqual({ "os-std": 499 });
    expect(paidFor(i, output, "Standard Shipping")).toBe(999);
    expect(output.operations[0].deliveryDiscountsAdd.candidates[0]).toEqual({
      message: "Combined shipping",
      targets: [{ deliveryOption: { handle: "os-std" } }],
      value: { fixedAmount: { amount: 4.99 } },
    });
  });

  test("3-way split → total equals band, smallest options absorb first", () => {
    const i = input({
      groups: [
        standardGroup("fw-std", "9.99", [line(2)]),
        standardGroup("os-std", "9.99", [line(1.5)]),
        standardGroup("on-std", "4.99", [line(0.5)]),
      ],
    });
    const output = run(i);

    // 4 lb → $11.99. Charged $24.97, overage $12.98: $4.99 + $7.99.
    expect(discountsByHandle(i, output)).toEqual({ "on-std": 499, "fw-std": 799 });
    expect(paidFor(i, output, "Standard Shipping")).toBe(1199);
  });

  test("N-way split where overage spans several options never exceeds any option's cost", () => {
    const i = input({
      groups: [
        standardGroup("a", "4.99", [line(0.2)]),
        standardGroup("b", "4.99", [line(0.2)]),
        standardGroup("c", "4.99", [line(0.2)]),
        standardGroup("d", "4.99", [line(0.2)]),
      ],
    });
    const output = run(i);

    // 0.8 lb → $4.99. Three whole options come off.
    expect(paidFor(i, output, "Standard Shipping")).toBe(499);
    expect(Object.values(discountsByHandle(i, output))).toEqual([499, 499, 499]);
  });

  test("0.9 lb + 0.9 lb → no ops ($9.98 is already below the $9.99 band)", () => {
    const i = input({
      groups: [
        standardGroup("fw-std", "4.99", [line(0.9)]),
        standardGroup("os-std", "4.99", [line(0.9)]),
      ],
    });
    expect(run(i)).toEqual(NO_OPS);
  });

  describe("band boundaries", () => {
    // Two packages each charged the top rate, so the customer pays exactly the band.
    const split = (totalLb) =>
      input({
        groups: [
          standardGroup("a", "17.99", [line(0.5)]),
          standardGroup("b", "17.99", [line(totalLb - 0.5)]),
        ],
      });

    test.each([
      [0.99, 499],
      [1.0, 999],
      [1.01, 999],
      [3.0, 999],
      [3.01, 1199],
      [5.0, 1199],
      [5.01, 1499],
      [8.0, 1499],
      [8.01, 1799],
      [40, 1799],
    ])("%s lb → %s cents", (lb, cents) => {
      const i = split(lb);
      expect(paidFor(i, run(i), "Standard Shipping")).toBe(cents);
    });
  });

  test("Standard at $0 → no ops", () => {
    const i = input({
      groups: [
        standardGroup("fw-std", "17.99", [line(6)]),
        standardGroup("os-std", "0.00", [line(4)]),
      ],
    });
    expect(run(i)).toEqual(NO_OPS);
  });

  test("only the exact \"Standard Shipping\" title is targeted, never \"Free Standard Shipping\"", () => {
    const free = (handle) => option(handle, "Free Standard Shipping", "0.00");
    const i = input({
      groups: [
        group({
          options: [free("fw-free"), option("fw-std", "Standard Shipping", "9.99")],
          lines: [line(2)],
        }),
        group({
          options: [option("os-std", "Standard Shipping", "4.99"), free("os-free")],
          lines: [line(0.5)],
        }),
      ],
    });
    const handles = Object.keys(discountsByHandle(i, run(i)));
    expect(handles).toEqual(["os-std"]);
  });

  test("a group offering only \"Free Standard Shipping\" → no Standard ops", () => {
    const i = input({
      groups: [
        standardGroup("fw-std", "9.99", [line(2)]),
        group({ options: [option("os-free", "Free Standard Shipping", "4.99")], lines: [line(1)] }),
      ],
    });
    expect(run(i)).toEqual(NO_OPS);
  });

  test("mixed weight units are converted to lb", () => {
    const i = input({
      groups: [
        // 16 oz + 907.18474 g = 1 lb + 2 lb = exactly 3 lb → $9.99 band.
        standardGroup("fw-std", "9.99", [line(16, "OUNCES"), line(907.18474, "GRAMS")]),
        standardGroup("os-std", "4.99", [line(0, "KILOGRAMS", { requiresShipping: false })]),
      ],
    });
    // Group b has no shipping lines, so it's not part of the Standard calculation.
    expect(run(i)).toEqual(NO_OPS);

    const j = input({
      groups: [
        standardGroup("fw-std", "9.99", [line(16, "OUNCES"), line(907.18474, "GRAMS")]),
        standardGroup("os-std", "4.99", [line(0.1, "KILOGRAMS")]),
      ],
    });
    // 3 lb + 0.22 lb → $11.99.
    expect(paidFor(j, run(j), "Standard Shipping")).toBe(1199);
  });

  test("quantity multiplies line weight", () => {
    const i = input({
      groups: [
        standardGroup("fw-std", "9.99", [line(0.5, "POUNDS", { quantity: 4 })]),
        standardGroup("os-std", "4.99", [line(0.5)]),
      ],
    });
    // 2.5 lb → $9.99.
    expect(paidFor(i, run(i), "Standard Shipping")).toBe(999);
  });

  test.each([
    ["missing", null],
    ["zero", 0],
  ])("a line with %s weight → no Standard ops", (_, weight) => {
    const i = input({
      groups: [
        standardGroup("fw-std", "9.99", [line(2), line(weight)]),
        standardGroup("os-std", "4.99", [line(0.5)]),
      ],
    });
    expect(run(i)).toEqual(NO_OPS);
  });

  test("an unknown weight unit → no Standard ops", () => {
    const i = input({
      groups: [
        standardGroup("fw-std", "9.99", [line(2, "STONES")]),
        standardGroup("os-std", "4.99", [line(0.5)]),
      ],
    });
    expect(run(i)).toEqual(NO_OPS);
  });

  test("requiresShipping: false lines are ignored in weight", () => {
    const i = input({
      groups: [
        standardGroup("fw-std", "9.99", [
          line(2),
          line(null, "POUNDS", { requiresShipping: false }),
          line(50, "POUNDS", { requiresShipping: false }),
        ]),
        standardGroup("os-std", "4.99", [line(0.5)]),
      ],
    });
    expect(paidFor(i, run(i), "Standard Shipping")).toBe(999);
  });

  test("packaging weight is added once per cart", () => {
    const config = withConfig({ packagingWeightLb: 0.6 });
    const i = input({
      config,
      groups: [
        standardGroup("fw-std", "9.99", [line(2)]),
        standardGroup("os-std", "4.99", [line(0.5)]),
      ],
    });
    // 2.5 + 0.6 = 3.1 lb → $11.99.
    expect(paidFor(i, run(i), "Standard Shipping")).toBe(1199);
  });

  test("Standard missing from one group → no Standard ops", () => {
    const i = input({
      groups: [
        standardGroup("fw-std", "9.99", [line(2)]),
        group({ options: [option("os-ups", UPS_2ND_DAY, "18.00")], lines: [line(0.5)] }),
      ],
    });
    expect(run(i)).toEqual(NO_OPS);
  });

  test("an ambiguous Standard option (title appears twice in a group) → no Standard ops", () => {
    const i = input({
      groups: [
        standardGroup("fw-std", "9.99", [line(2)], [option("fw-std-2", "Standard Shipping", "8.99")]),
        standardGroup("os-std", "4.99", [line(0.5)]),
      ],
    });
    expect(run(i)).toEqual(NO_OPS);
  });
});

describe("gating and fail-open", () => {
  const splitGroups = () => [
    standardGroup("fw-std", "9.99", [line(2)]),
    standardGroup("os-std", "4.99", [line(0.5)]),
  ];

  test("non-US address → no ops", () => {
    const groups = splitGroups();
    groups[1].deliveryAddress.countryCode = "CA";
    expect(run(input({ groups }))).toEqual(NO_OPS);
  });

  test("missing delivery address → no ops", () => {
    const groups = splitGroups();
    groups[0].deliveryAddress = null;
    expect(run(input({ groups }))).toEqual(NO_OPS);
  });

  test("currency mismatch → no ops", () => {
    const i = input({
      groups: [
        group({ options: [option("fw-std", "Standard Shipping", "9.99", "CAD")], lines: [line(2)] }),
        group({ options: [option("os-std", "Standard Shipping", "4.99", "CAD")], lines: [line(0.5)] }),
      ],
    });
    expect(run(i)).toEqual(NO_OPS);
  });

  test("testMode on, untagged customer → no ops", () => {
    expect(run(input({ groups: splitGroups(), tagged: false }))).toEqual(NO_OPS);
  });

  test("testMode on, no customer → no ops", () => {
    const i = input({ groups: splitGroups() });
    i.cart.buyerIdentity = null;
    expect(run(i)).toEqual(NO_OPS);
  });

  test("testMode off applies to untagged customers", () => {
    const i = input({ groups: splitGroups(), tagged: false, config: withConfig({ testMode: false }) });
    expect(run(i).operations).toHaveLength(1);
  });

  test("enabled: false → no ops", () => {
    expect(run(input({ groups: splitGroups(), config: withConfig({ enabled: false }) }))).toEqual(
      NO_OPS,
    );
  });

  test("dryRun computes but returns no ops", () => {
    expect(run(input({ groups: splitGroups(), config: withConfig({ dryRun: true }) }))).toEqual(
      NO_OPS,
    );
  });

  test("discount without the SHIPPING class → no ops", () => {
    expect(run(input({ groups: splitGroups(), discountClasses: ["ORDER"] }))).toEqual(NO_OPS);
  });

  test.each([
    ["null", null],
    ["a string", "{\"enabled\":true}"],
    ["an array", [CONFIG]],
    ["enabled not boolean", withConfig({ enabled: "yes" })],
    ["testMode without testTags", withConfig({ testTags: undefined })],
    ["lowercase currency", withConfig({ currency: "usd" })],
    ["empty countries", withConfig({ countries: [] })],
    ["negative packaging weight", withConfig({ packagingWeightLb: -1 })],
    ["empty message", withConfig({ message: "" })],
    ["missing standard", withConfig({ standard: undefined })],
    ["empty bands", withConfig({ standard: { titles: ["Standard Shipping"], bands: [] } })],
    [
      "unsorted bands",
      withConfig({
        standard: {
          titles: ["Standard Shipping"],
          bands: [
            { maxLb: 3, cents: 999 },
            { maxLb: 1, cents: 499 },
          ],
        },
      }),
    ],
    [
      "open band not last",
      withConfig({
        standard: {
          titles: ["Standard Shipping"],
          bands: [
            { maxLb: null, cents: 1799 },
            { maxLb: 1, cents: 499 },
          ],
        },
      }),
    ],
    [
      "fractional cents",
      withConfig({
        standard: { titles: ["Standard Shipping"], bands: [{ maxLb: null, cents: 9.99 }] },
      }),
    ],
    ["ups not an object", withConfig({ ups: true })],
  ])("malformed config (%s) → no ops, no throw", (_, config) => {
    const i = input({ groups: splitGroups(), config });
    expect(() => run(i)).not.toThrow();
    expect(run(i)).toEqual(NO_OPS);
  });

  test("no config metafield → no ops", () => {
    const i = input({ groups: splitGroups() });
    i.discount.metafield = null;
    expect(run(i)).toEqual(NO_OPS);
  });

  test("malformed input → no ops, no throw", () => {
    // deliveryOptions is missing, so reading it throws inside the function.
    const output = cartDeliveryOptionsDiscountsGenerateRun({
      cart: { deliveryGroups: [{ id: "x", deliveryAddress: { countryCode: "US" } }] },
      discount: {
        discountClasses: ["SHIPPING"],
        metafield: { jsonValue: withConfig({ testMode: false }) },
      },
    });
    expect(output).toEqual(NO_OPS);
  });

  test("unparseable cost amount → no ops", () => {
    const groups = splitGroups();
    groups[0].deliveryOptions[0].cost.amount = "9.999";
    expect(run(input({ groups }))).toEqual(NO_OPS);
  });

  test("no delivery groups → no ops", () => {
    expect(run(input({ groups: [] }))).toEqual(NO_OPS);
  });
});

describe("UPS services", () => {
  const upsGroup = (prefix, standardAmount, upsRates, lines) =>
    group({
      options: [
        option(`${prefix}-std`, "Standard Shipping", standardAmount),
        ...Object.entries(upsRates).map(([title, amount]) =>
          option(`${prefix}-${title}`, title, amount),
        ),
      ],
      lines,
    });

  test("disabled by default → UPS untouched", () => {
    const i = input({
      groups: [
        upsGroup("fw", "9.99", { [UPS_2ND_DAY]: "25.40" }, [line(2)]),
        upsGroup("os", "9.99", { [UPS_2ND_DAY]: "18.10" }, [line(2)]),
      ],
    });
    // Standard: 4 lb → $11.99, so $7.99 comes off one Standard option. No UPS candidates.
    expect(Object.keys(discountsByHandle(i, run(i)))).toEqual(["fw-std"]);
  });

  test("2-way → highest kept, other 100% off", () => {
    const i = input({
      config: UPS_ON,
      groups: [
        upsGroup("fw", "9.99", { [UPS_2ND_DAY]: "25.40" }, [line(2)]),
        upsGroup("os", "4.99", { [UPS_2ND_DAY]: "18.10" }, [line(0.5)]),
      ],
    });
    const output = run(i);
    expect(discountsByHandle(i, output)).toEqual({
      "os-std": 499,
      [`os-${UPS_2ND_DAY}`]: 1810,
    });
    expect(paidFor(i, output, UPS_2ND_DAY)).toBe(2540);
    expect(output.operations[0].deliveryDiscountsAdd.candidates).toContainEqual({
      message: "Combined shipping",
      targets: [{ deliveryOption: { handle: `os-${UPS_2ND_DAY}` } }],
      value: { percentage: { value: 100 } },
    });
  });

  test("3-way, several services → highest kept per service, others 100% off", () => {
    const i = input({
      config: UPS_ON,
      groups: [
        upsGroup("fw", "9.99", { [UPS_2ND_DAY]: "20.00", [UPS_NEXT_DAY]: "40.00" }, [line(2)]),
        upsGroup("os", "9.99", { [UPS_2ND_DAY]: "31.00", [UPS_NEXT_DAY]: "38.00" }, [line(2)]),
        upsGroup("on", "4.99", { [UPS_2ND_DAY]: "12.00", [UPS_3_DAY]: "9.00" }, [line(0.5)]),
      ],
    });
    const output = run(i);
    const discounts = discountsByHandle(i, output);

    expect(paidFor(i, output, UPS_2ND_DAY)).toBe(3100);
    expect(discounts[`fw-${UPS_NEXT_DAY}`]).toBeUndefined();
    expect(discounts[`os-${UPS_NEXT_DAY}`]).toBe(3800);
    // Only one group offers 3 Day Select, so there's nothing to combine.
    expect(discounts[`on-${UPS_3_DAY}`]).toBeUndefined();
  });

  test("ties keep exactly one rate", () => {
    const i = input({
      config: UPS_ON,
      groups: [
        upsGroup("fw", "9.99", { [UPS_2ND_DAY]: "20.00" }, [line(2)]),
        upsGroup("os", "9.99", { [UPS_2ND_DAY]: "20.00" }, [line(2)]),
      ],
    });
    expect(paidFor(i, run(i), UPS_2ND_DAY)).toBe(2000);
  });

  test("one merged group → no ops", () => {
    const i = input({
      config: UPS_ON,
      groups: [upsGroup("all", "9.99", { [UPS_2ND_DAY]: "45.00" }, [line(2), line(0.5)])],
    });
    expect(run(i)).toEqual(NO_OPS);
  });

  test("UPS still combines when Standard is skipped", () => {
    const i = input({
      config: UPS_ON,
      groups: [
        upsGroup("fw", "9.99", { [UPS_2ND_DAY]: "25.40" }, [line(null)]),
        upsGroup("os", "4.99", { [UPS_2ND_DAY]: "18.10" }, [line(0.5)]),
      ],
    });
    expect(discountsByHandle(i, run(i))).toEqual({ [`os-${UPS_2ND_DAY}`]: 1810 });
  });
});
