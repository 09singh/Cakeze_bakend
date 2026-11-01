const assert = require("node:assert/strict");
const test = require("node:test");

const { sharedOrderSchema } = require("./order.validator");
const Order = require("./order.model");

const item = {
  itemType: "Cake",
  productId: "507f1f77bcf86cd799439011",
  size: "1 Kg",
  flavour: "Chocolate",
  quantity: 1,
  customisation: {
    eggless: false,
    theme: "",
    messageOnCake: "",
    designNotes: "",
    hasAllergy: false,
    allergyNotes: "",
    referenceImages: [],
  },
};

const validOrder = {
  checkoutId: "123e4567-e89b-42d3-a456-426614174000",
  phone: "9876543210",
  customerName: "Cakezee Customer",
  occasion: "Birthday",
  additionalNotes: "",
  items: [item, { ...item, productId: "507f1f77bcf86cd799439012" }],
  delivery: {
    method: "pickup",
    date: "2027-01-10",
    time: "10:00 AM - 11:00 AM",
    address: "",
    mapLink: "",
    mapLinkText: "",
  },
};

test("accepts one combined shared order with multiple cakes", () => {
  const { error, value } = sharedOrderSchema.validate(validOrder);
  assert.equal(error, undefined);
  assert.equal(value.items.length, 2);
});

test("accepts a customer-typed flavour without requiring a catalog flavour match", () => {
  const { error, value } = sharedOrderSchema.validate({
    ...validOrder,
    items: [{ ...item, flavour: "Dark chocolate with raspberry" }],
  });
  assert.equal(error, undefined);
  assert.equal(value.items[0].flavour, "Dark chocolate with raspberry");
});

test("rejects a customer-typed flavour longer than fifty characters", () => {
  const { error } = sharedOrderSchema.validate({
    ...validOrder,
    items: [{ ...item, flavour: "x".repeat(51) }],
  });
  assert.ok(error);
});

test("accepts non-cake items without a weight selection and defaults size to piece", () => {
  const { error, value } = sharedOrderSchema.validate({
    ...validOrder,
    items: [{ ...item, itemType: "Brownie", size: undefined }],
  });
  assert.equal(error, undefined);
  assert.equal(value.items[0].size, "piece");
});

test("requires a size selection for cakes", () => {
  const { error } = sharedOrderSchema.validate({
    ...validOrder,
    items: [{ ...item, size: undefined }],
  });
  assert.ok(error);
});

test("limits shared orders to ten items", () => {
  const { error } = sharedOrderSchema.validate({
    ...validOrder,
    items: Array.from({ length: 11 }, (_, index) => ({
      ...item,
      productId: index % 2 ? item.productId : "507f1f77bcf86cd799439012",
    })),
  });
  assert.ok(error);
});

test("requires a delivery address for delivery orders", () => {
  const { error } = sharedOrderSchema.validate({
    ...validOrder,
    delivery: { ...validOrder.delivery, method: "delivery", address: "" },
  });
  assert.ok(error);
});

test("caps reference photos at five and limits combined encoded size", () => {
  const tooManyPhotos = sharedOrderSchema.validate({
    ...validOrder,
    items: [{
      ...item,
      customisation: {
        ...item.customisation,
        referenceImages: Array(6).fill("data:image/png;base64,YQ=="),
      },
    }],
  });
  assert.ok(tooManyPhotos.error);

  const oversizedPhotos = sharedOrderSchema.validate({
    ...validOrder,
    items: [{
      ...item,
      customisation: {
        ...item.customisation,
        referenceImages: ["x".repeat(400001), "x".repeat(300001)],
      },
    }],
  });
  assert.ok(oversizedPhotos.error);
});

test("order model accepts combined product snapshots and per-item customisations", () => {
  const order = new Order({
    orderId: "CZ0123456789ABCDEF0123",
    checkoutId: validOrder.checkoutId,
    phone: "9876543210",
    customerName: "Cakezee Customer",
    productId: item.productId,
    productName: "Chocolate Cake",
    size: item.size,
    weight: 1,
    flavour: item.flavour,
    quantity: 1,
    customisation: item.customisation,
    delivery: validOrder.delivery,
    pricing: {
      cakePrice: 1000,
      addonsTotal: 0,
      deliveryFee: 0,
      subtotal: 1000,
      discount: 0,
      total: 1000,
    },
    payment: { method: "cod", status: "pending" },
    items: [
      {
        productId: item.productId,
        name: "Chocolate Cake",
        size: item.size,
        weight: 1,
        flavour: item.flavour,
        quantity: 1,
        unitPrice: 1000,
        lineTotal: 1000,
        customisation: item.customisation,
      },
      {
        productId: "507f1f77bcf86cd799439012",
        name: "Vanilla Cake",
        size: "0.5 Kg",
        weight: 0.5,
        flavour: "Vanilla",
        quantity: 2,
        unitPrice: 500,
        lineTotal: 1000,
        customisation: { theme: "Blue" },
      },
    ],
  });

  assert.equal(order.validateSync(), undefined);
  assert.equal(order.items.length, 2);
  assert.equal(order.items[1].customisation.theme, "Blue");
});
