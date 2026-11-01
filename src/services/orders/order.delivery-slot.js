const AppError = require("../../utils/AppError");

const BAKERY_TIME_ZONE = "Asia/Kolkata";
const OPENING_HOUR = 10;
const CLOSING_HOUR = 20;

function getBakeryDateTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BAKERY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function getSlotStartHour(time) {
  const match = String(time || "").match(
    /^\s*(\d{1,2}):00\s*(AM|PM)\s*-\s*(\d{1,2}):00\s*(AM|PM)\s*$/i
  );
  if (!match) return null;

  const toHour = (displayedHour, period) => {
    const hour = Number(displayedHour);
    if (hour < 1 || hour > 12) return null;
    return (hour % 12) + (period.toUpperCase() === "PM" ? 12 : 0);
  };
  const startHour = toHour(match[1], match[2]);
  const endHour = toHour(match[3], match[4]);

  return startHour !== null && endHour === startHour + 1 ? startHour : null;
}

function assertDeliverySlotAvailable(delivery, now = new Date()) {
  const clock = getBakeryDateTime(now);
  const deliveryDate = String(delivery?.date || "");
  const slotStartHour = getSlotStartHour(delivery?.time);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate);

  if (
    !validDate ||
    deliveryDate < clock.date ||
    slotStartHour === null ||
    slotStartHour < OPENING_HOUR ||
    slotStartHour >= CLOSING_HOUR
  ) {
    throw new AppError(
      "Please select a valid delivery date and time during store hours.",
      400,
      "INVALID_DELIVERY_SLOT"
    );
  }

  const earliestHour =
    clock.hour + 2 + (clock.minute >= 45 ? 1 : 0);
  if (deliveryDate === clock.date && slotStartHour < earliestHour) {
    throw new AppError(
      "Please select a delivery slot at least two hours from now.",
      400,
      "DELIVERY_SLOT_TOO_SOON"
    );
  }
}

module.exports = { assertDeliverySlotAvailable, getBakeryDateTime, getSlotStartHour };
