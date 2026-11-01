const assert = require("node:assert/strict");
const test = require("node:test");

const Product = require("./product.model");
const { createReadyNowProductSchema } = require("./product.validator");

const readyNowProduct = (readyNowCategory) => ({
  name: "Section product",
  slug: `section-product-${readyNowCategory.replaceAll("_", "-")}`,
  readyNowCategory,
  price: 250,
  inventoryQuantity: 4,
});

for (const category of ["mini_delight", "surprise_hampers"]) {
  test(`accepts ${category} products through the Ready Now creation schema`, () => {
    const { error, value } = createReadyNowProductSchema.validate(readyNowProduct(category));
    assert.equal(error, undefined);
    assert.equal(value.readyNowCategory, category);
  });

  test(`persists ${category} as a valid Ready Now product category`, () => {
    const product = new Product({
      ...readyNowProduct(category),
      productType: "ready_now",
      categoryId: null,
      sizes: [{ name: "1 item", value: 1, unit: "item" }],
      flavours: [{ name: "Standard", basePrice: 250 }],
    });
    assert.equal(product.validateSync(), undefined);
  });
}
