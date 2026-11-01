const assert = require("node:assert/strict");
const test = require("node:test");

const {
  TRANSITIONS,
  assertCustomerCanEditDelivery,
  assertCustomerCanCancelDelivery,
  getDeliveryStart,
  recordPayment,
} = require("./order.lifecycle");
const Order = require("./order.model");

function deliveryForOffset(offsetMs) {
  const scheduled = new Date(Date.now() + offsetMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).formatToParts(scheduled);
  const value = (type) => parts.find((part) => part.type === type).value;
  const hour = Number(value("hour"));
  const minute = value("minute");
  const meridiem = value("dayPeriod").replace(/\./g, "").toUpperCase();

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${hour}:${minute} ${meridiem} - ${hour}:${minute} ${meridiem}`,
  };
}

test("parses delivery-slot start times in the bakery timezone", () => {
  const deliveryStart = getDeliveryStart({
    date: "2027-01-10",
    time: "10:00 AM - 11:00 AM",
  });

  assert.equal(deliveryStart.toISOString(), "2027-01-10T04:30:00.000Z");
});

test("allows customer edits more than one hour before delivery", () => {
  assert.doesNotThrow(() => assertCustomerCanEditDelivery(deliveryForOffset(2 * 60 * 60 * 1000)));
});

test("rejects customer edits within one hour of delivery", () => {
  assert.throws(
    () => assertCustomerCanEditDelivery(deliveryForOffset(30 * 60 * 1000)),
    /more than one hour before delivery/
  );
});

test("allows customer cancellation exactly two hours before delivery", () => {
  const delivery = {
    date: "2027-01-10",
    time: "10:00 AM - 11:00 AM",
  };
  const now = new Date("2027-01-10T02:30:00.000Z").getTime();

  assert.doesNotThrow(() => assertCustomerCanCancelDelivery(delivery, now));
});

test("rejects customer cancellation less than two hours before delivery", () => {
  const delivery = {
    date: "2027-01-10",
    time: "10:00 AM - 11:00 AM",
  };
  const now = new Date("2027-01-10T02:30:01.000Z").getTime();

  assert.throws(
    () => assertCustomerCanCancelDelivery(delivery, now),
    /at least two hours before delivery/
  );
});

test("delivery orders can be cancelled from each active delivery status", () => {
  for (const status of ["Ready for Delivery", "Out for Delivery", "Delivery Failed"]) {
    assert.ok(TRANSITIONS[status].includes("Cancelled"));
  }
});

test("delivery staff can record cash collected after delivery for reconciliation", async () => {
  const user = { _id: "delivery-id", role: "delivery", name: "Delivery Staff" };
  const originalFindOne = Order.findOne;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;

  try {
    for (const originalMethod of ["cod", "cash", "upi", "card"]) {
      const order = {
        _id: "order-id",
        orderId: "CZ123",
        status: "Delivered",
        assignedDelivery: "delivery-id",
        lifecycleVersion: 1,
        payment: { method: originalMethod, status: "pending" },
        pricing: { total: 2400 },
      };
      let recordedUpdate;

      Order.findOne = async () => order;
      Order.findOneAndUpdate = (_filter, update) => {
        recordedUpdate = update;
        return {
          lean: async () => ({
            ...order,
            payment: {
              ...order.payment,
              status: update.$set["payment.status"],
              collectedAmount: update.$set["payment.collectedAmount"],
            },
          }),
        };
      };

      const updated = await recordPayment("CZ123", 2400, "cash", user);

      assert.equal(updated.payment.status, "paid", `${originalMethod} order is marked paid`);
      assert.equal(recordedUpdate.$push.paymentHistory.next, "paid");
      assert.equal(recordedUpdate.$push.paymentHistory.amount, 2400);
      assert.equal(recordedUpdate.$push.paymentHistory.method, "cash");
    }
  } finally {
    Order.findOne = originalFindOne;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
