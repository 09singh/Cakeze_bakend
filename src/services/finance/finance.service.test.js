const assert = require("node:assert/strict");
const test = require("node:test");

const { outstandingAmount, paymentEventsForOrder } = require("./finance.service");

test("delivered COD orders remain outstanding until collection is recorded", () => {
  assert.equal(outstandingAmount({
    status: "Delivered",
    payment: { status: "pending" },
    pricing: { total: 2400 },
  }), 2400);
  assert.equal(outstandingAmount({
    status: " delivered ",
    payment: { status: "pending" },
    pricing: { total: 2400 },
  }), 2400);
  assert.equal(outstandingAmount({
    status: "Delivered",
    payment: { status: "paid", collectedAmount: 2400 },
    pricing: { total: 2400 },
  }), 0);
});

test("paid orders are not outstanding before delivery", () => {
  assert.equal(outstandingAmount({
    status: "Out for Delivery",
    payment: { status: "paid", collectedAmount: 2400 },
    pricing: { total: 2400 },
  }), 0);
});

test("unpaid orders not yet delivered remain outstanding", () => {
  assert.equal(outstandingAmount({
    status: "Preparing",
    payment: { status: "pending", collectedAmount: 500 },
    pricing: { total: 2400 },
  }), 1900);
});

test("confirmed orders are not outstanding until preparation starts", () => {
  assert.equal(outstandingAmount({
    status: "Confirmed",
    payment: { status: "pending" },
    pricing: { total: 2400 },
  }), 0);
});

test("unpaid orders remain outstanding until paid", () => {
  for (const status of ["Preparing", "Ready for Delivery", "Out for Delivery", "Delivery Failed", "Returned to Bakery", "Delivered"]) {
    assert.ok(outstandingAmount({
      status,
      payment: { status: "pending" },
      pricing: { total: 2400 },
    }) > 0, `${status} must remain outstanding until paid or delivered`);
  }
});

test("delivered orders without a paid history do not appear as reconciliation receipts", () => {
  const events = paymentEventsForOrder({
    status: "Delivered",
    statusUpdatedAt: new Date("2026-10-28T10:00:00.000Z"),
    statusHistory: [{
      next: "Delivered",
      at: new Date("2026-10-28T10:00:00.000Z"),
      actor: { role: "delivery", name: "Delivery Staff" },
    }],
    payment: { status: "pending", method: "cod" },
    pricing: { total: 2400 },
    paymentHistory: [{ previous: "pending", next: "pending", amount: 0 }],
  });

  assert.equal(events.length, 0);
});

test("an existing paid event is not duplicated in reconciliation", () => {
  const events = paymentEventsForOrder({
    status: "Delivered",
    payment: { status: "paid", collectedAmount: 2400 },
    pricing: { total: 2400 },
    paymentHistory: [{ previous: "pending", next: "paid", amount: 2400 }],
  });

  assert.equal(events.length, 1);
});

test("delivery collection moves a pending order from outstanding to cash reconciliation", () => {
  const recordedAt = new Date("2026-10-28T10:00:00.000Z");
  const order = {
    status: "Delivered",
    payment: {
      status: "paid",
      method: "cash",
      collectedAmount: 2400,
      recordedAt,
      recordedBy: { role: "delivery", name: "Delivery Staff" },
    },
    pricing: { total: 2400 },
    paymentHistory: [{
      previous: "pending",
      next: "paid",
      amount: 2400,
      method: "cash",
      at: recordedAt,
      actor: { role: "delivery", name: "Delivery Staff" },
    }],
  };

  assert.equal(outstandingAmount(order), 0);
  assert.deepEqual(paymentEventsForOrder(order).map((event) => ({
    amount: event.amount,
    method: event.method,
    at: event.at,
    actorRole: event.actor.role,
  })), [{
    amount: 2400,
    method: "cash",
    at: recordedAt,
    actorRole: "delivery",
  }]);
});

test("legacy paid events inherit the order payment date when the event date is missing", () => {
  const recordedAt = new Date("2026-10-28T10:00:00.000Z");
  const events = paymentEventsForOrder({
    status: "Delivered",
    payment: { status: "paid", method: "upi", collectedAmount: 2400, recordedAt },
    pricing: { total: 2400 },
    paymentHistory: [{ previous: "pending", next: "paid" }],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].amount, 2400);
  assert.equal(events[0].method, "upi");
  assert.equal(events[0].at, recordedAt);
});
