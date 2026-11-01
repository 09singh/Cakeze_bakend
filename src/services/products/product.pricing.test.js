const assert = require("node:assert/strict");
const test = require("node:test");

const { calculateProductPrice } = require("./product.pricing");

test("applies each selected collection increment for every half kilogram", () => {
  const cases = [
    ["everyday_favorite", 300],
    ["trending_collection", 400],
    ["signature_collection", 500],
  ];

  for (const [collection, increment] of cases) {
    const product = { pricing: { baseWeight: 0.5, collection } };
    const flavour = { basePrice: 250 };

    assert.equal(calculateProductPrice(product, 0.5, flavour), 250);
    assert.equal(calculateProductPrice(product, 1, flavour), 250 + increment);
    assert.equal(calculateProductPrice(product, 1.5, flavour), 250 + increment * 2);
  }
});

test("retains proportional pricing for products without a collection rule", () => {
  assert.equal(
    calculateProductPrice({ pricing: { baseWeight: 0.5 } }, 1.5, { basePrice: 250 }),
    750
  );
});
