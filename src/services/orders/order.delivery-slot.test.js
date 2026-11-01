const assert = require("node:assert/strict");
const test = require("node:test");

const { assertDeliverySlotAvailable } = require("./order.delivery-slot");

const delivery = (time, date = "2026-10-29") => ({ date, time });
const bakeryTime = (hour, minute) =>
  new Date(Date.UTC(2026, 9, 29, hour - 5, minute - 30));

test("allows a slot two hours after the current hour", () => {
  assert.doesNotThrow(() =>
    assertDeliverySlotAvailable(delivery("5:00 PM - 6:00 PM"), bakeryTime(15, 0))
  );
  assert.throws(
    () => assertDeliverySlotAvailable(delivery("4:00 PM - 5:00 PM"), bakeryTime(15, 0)),
    { code: "DELIVERY_SLOT_TOO_SOON" }
  );
});

test("rounds the minimum slot forward at 3:45 PM", () => {
  assert.doesNotThrow(() =>
    assertDeliverySlotAvailable(delivery("5:00 PM - 6:00 PM"), bakeryTime(15, 44))
  );
  assert.throws(
    () => assertDeliverySlotAvailable(delivery("5:00 PM - 6:00 PM"), bakeryTime(15, 45)),
    { code: "DELIVERY_SLOT_TOO_SOON" }
  );
  assert.doesNotThrow(() =>
    assertDeliverySlotAvailable(delivery("6:00 PM - 7:00 PM"), bakeryTime(15, 45))
  );
});

test("allows future-date slots during store hours", () => {
  assert.doesNotThrow(() =>
    assertDeliverySlotAvailable(
      delivery("10:00 AM - 11:00 AM", "2026-10-30"),
      bakeryTime(19, 0)
    )
  );
});

test("rejects past dates and times outside store hours", () => {
  assert.throws(
    () => assertDeliverySlotAvailable(delivery("5:00 PM - 6:00 PM", "2026-10-28"), bakeryTime(15, 0)),
    { code: "INVALID_DELIVERY_SLOT" }
  );
  assert.throws(
    () => assertDeliverySlotAvailable(delivery("8:00 PM - 9:00 PM", "2026-10-30"), bakeryTime(15, 0)),
    { code: "INVALID_DELIVERY_SLOT" }
  );
  assert.throws(
    () => assertDeliverySlotAvailable(delivery("5:00 PM - 7:00 PM", "2026-10-30"), bakeryTime(15, 0)),
    { code: "INVALID_DELIVERY_SLOT" }
  );
});
