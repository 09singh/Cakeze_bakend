const Order = require("./order.model");
const AppError = require("../../utils/AppError");

const TRANSITIONS = {
  "Pending Payment": ["Confirmed", "Cancelled"],
  Confirmed: ["Preparing", "Cancelled"],
  Preparing: ["Ready for Delivery"],
  "Ready for Delivery": ["Out for Delivery", "Cancelled"],
  "Out for Delivery": ["Delivered", "Delivery Failed", "Cancelled"],
  "Delivery Failed": ["Out for Delivery", "Returned to Bakery", "Cancelled"],
};

function actor(user) {
  return { userId: user._id, role: user.role, name: user.name || user.email || "" };
}

function withHistory(previous, next, user, reason, extra = {}) {
  return {
    $set: { status: next, statusUpdatedAt: new Date(), ...extra },
    $push: {
      statusHistory: {
        previous, next, at: new Date(), actor: actor(user),
        reason: reason || "", ...extra.historyData,
      },
    },
    $inc: { lifecycleVersion: 1 },
  };
}

function expectedFilter(order, expectedVersion) {
  const filter = { _id: order._id, status: order.status };
  if (Number.isInteger(expectedVersion)) filter.lifecycleVersion = expectedVersion;
  return filter;
}

function getDeliveryStart(delivery) {
  const dateParts = String(delivery?.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeParts = String(delivery?.time || "").match(/^\s*(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (!dateParts || !timeParts) return null;

  const [, year, month, day] = dateParts.map(Number);
  let hour = Number(timeParts[1]);
  const minute = Number(timeParts[2]);
  const meridiem = timeParts[3].toUpperCase();
  if (hour < 1 || hour > 12 || minute > 59) return null;
  hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);

  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    wallClock.getUTCFullYear() !== year ||
    wallClock.getUTCMonth() !== month - 1 ||
    wallClock.getUTCDate() !== day
  ) return null;

  return new Date(wallClock.getTime() - (5 * 60 + 30) * 60 * 1000);
}

function assertCustomerCanEditDelivery(delivery) {
  const deliveryStart = getDeliveryStart(delivery);
  if (!deliveryStart || deliveryStart.getTime() - Date.now() <= 60 * 60 * 1000) {
    throw new AppError(
      "Order details can only be changed more than one hour before delivery.",
      409,
      "ORDER_EDIT_WINDOW_CLOSED"
    );
  }
}

function assertCustomerCanCancelDelivery(delivery, now = Date.now()) {
  const deliveryStart = getDeliveryStart(delivery);
  if (!deliveryStart || deliveryStart.getTime() - now < 2 * 60 * 60 * 1000) {
    throw new AppError(
      "Orders can only be cancelled at least two hours before delivery.",
      409,
      "CANCELLATION_WINDOW_CLOSED"
    );
  }
}

async function updateOrderDetails(orderId, details, { phone, user, expectedVersion, admin = false }) {
  const filter = admin
    ? { orderId }
    : user?.role === "customer"
      ? { orderId, ...(user._id ? { customer: user._id } : { customerEmail: user.email }) }
      : { orderId, phone: String(phone || "").replace(/\D/g, "") };
  const order = await Order.findOne(filter);
  if (!order) {
    throw new AppError(
      admin ? "Order not found." : "No order matched that phone number and reference.",
      404,
      "ORDER_NOT_FOUND"
    );
  }

  if (["Delivered", "Cancelled", "Rejected", "Returned to Bakery"].includes(order.status)) {
    throw new AppError("This order can no longer be changed.", 409, "ORDER_CLOSED");
  }
  if (!admin) {
    assertCustomerCanEditDelivery(order.delivery);
    assertCustomerCanEditDelivery(details.delivery);
  }

  const actorDetails = admin
    ? actor(user)
    : { userId: null, role: "customer", name: order.customerName || "" };
  const update = {
    $set: {
      customerName: details.customerName,
      occasion: details.occasion,
      occasionDate: details.occasionDate,
      "delivery.date": details.delivery.date,
      "delivery.time": details.delivery.time,
      "delivery.address": details.delivery.address,
      "delivery.mapLink": details.delivery.mapLink,
      "delivery.mapLinkText": details.delivery.mapLinkText,
      ...Object.fromEntries(
        Object.entries(details.customisation).map(([field, value]) => [
          `customisation.${field}`,
          value,
        ])
      ),
    },
    $push: {
      statusHistory: {
        previous: order.status,
        next: order.status,
        at: new Date(),
        actor: actorDetails,
        reason: admin ? "Order details updated by Admin" : "Order details updated by customer",
      },
    },
    $inc: { lifecycleVersion: 1 },
  };
  if (order.items?.length) {
    Object.entries(details.customisation).forEach(([field, value]) => {
      update.$set[`items.0.customisation.${field}`] = value;
    });
  }
  const versionFilter = expectedFilter(order, expectedVersion);
  if (Number.isInteger(expectedVersion) && order.lifecycleVersion == null && expectedVersion === 0) {
    versionFilter.lifecycleVersion = { $in: [0, null] };
  }
  if (!admin) {
    if (user?.role === "customer") {
      if (user._id) versionFilter.customer = user._id;
      else versionFilter.customerEmail = user.email;
    } else {
      versionFilter.phone = String(phone || "").replace(/\D/g, "");
    }
  }
  const updated = await Order.findOneAndUpdate(
    versionFilter,
    update,
    { new: true, runValidators: true }
  ).lean();
  if (!updated) throw new AppError("Order changed since it was loaded. Refresh and retry.", 409, "ORDER_VERSION_CONFLICT");
  return updated;
}

async function transition(orderId, next, user, { reason = "", expectedVersion, override = false } = {}) {
  const order = await Order.findOne({ orderId });
  if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  if (user.role === "kitchen" && !((order.status === "Confirmed" && next === "Preparing") || (order.status === "Preparing" && next === "Ready for Delivery"))) throw new AppError("Kitchen staff cannot make this status change.", 403, "FORBIDDEN");
  if (user.role === "delivery" && !(["Ready for Delivery", "Delivery Failed", "Out for Delivery"].includes(order.status) && ["Out for Delivery", "Delivered", "Delivery Failed", "Returned to Bakery", "Cancelled"].includes(next))) throw new AppError("Delivery staff cannot make this status change.", 403, "FORBIDDEN");
  if (!override && !(TRANSITIONS[order.status] || []).includes(next)) {
    throw new AppError("This order status transition is not allowed.", 409, "INVALID_TRANSITION");
  }
  if (override && !reason.trim()) throw new AppError("A reason is required for an admin override.", 400, "REASON_REQUIRED");
  if (next === "Cancelled" && !reason.trim()) {
    throw new AppError("A cancellation reason is required.", 400, "REASON_REQUIRED");
  }
  const filter = expectedFilter(order, expectedVersion);
  const shouldClaimDelivery = user.role === "delivery" &&
    !order.assignedDelivery && order.status === "Ready for Delivery" && next === "Out for Delivery";
  if (user.role === "delivery" && !shouldClaimDelivery && String(order.assignedDelivery || "") !== String(user._id)) {
    throw new AppError("This order is not assigned to you.", 403, "ORDER_NOT_ASSIGNED");
  }
  if (shouldClaimDelivery) filter.assignedDelivery = null;
  const extra = override ? { adminOverride: true } : {};
  if (shouldClaimDelivery) extra.assignedDelivery = user._id;
  if (next === "Cancelled") {
    extra.cancelledAt = new Date();
    extra.cancellation = {
      requestedBy: user._id,
      source: user.role,
      reason: reason.trim(),
      requestedAt: new Date(),
      decision: "approved",
      decidedBy: actor(user),
      decidedAt: new Date(),
      operationalOutcome: order.status,
    };
  }
  const update = withHistory(order.status, next, user, reason, extra);
  const updated = await Order.findOneAndUpdate(filter, update, { new: true, runValidators: true }).lean();
  if (!updated) throw new AppError("Order changed since it was loaded. Refresh and retry.", 409, "ORDER_VERSION_CONFLICT");
  return updated;
}

async function cancelOrder(orderId, reason, user) {
  const order = await Order.findOne({ orderId });
  if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  if (["Delivered", "Cancelled", "Rejected", "Returned to Bakery"].includes(order.status)) {
    throw new AppError("This order can no longer be cancelled.", 409, "CANCELLATION_NOT_ALLOWED");
  }

  if (user.role === "customer") {
    const ownership = user._id
      ? { customer: user._id }
      : { customerEmail: user.email };
    if (!await Order.exists({ _id: order._id, ...ownership })) {
      throw new AppError("You can only cancel your own orders.", 403, "FORBIDDEN");
    }
    assertCustomerCanCancelDelivery(order.delivery);
  } else if (user.role === "delivery") {
    if (!["Ready for Delivery", "Out for Delivery", "Delivery Failed"].includes(order.status)) {
      throw new AppError("Delivery staff can only cancel an assigned delivery.", 409, "CANCELLATION_NOT_ALLOWED");
    }
    if (String(order.assignedDelivery || "") !== String(user._id)) {
      throw new AppError("This order is not assigned to you.", 403, "ORDER_NOT_ASSIGNED");
    }
  } else if (user.role !== "admin") {
    throw new AppError("You are not allowed to cancel this order.", 403, "FORBIDDEN");
  }

  const now = new Date();
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status, lifecycleVersion: order.lifecycleVersion },
    {
      $set: {
        status: "Cancelled",
        statusUpdatedAt: now,
        cancelledAt: now,
        cancellation: {
          requestedBy: user._id,
          source: user.role,
          reason: reason.trim(),
          requestedAt: now,
          decision: "approved",
          decidedBy: actor(user),
          decidedAt: now,
          operationalOutcome: order.status,
        },
      },
      $push: {
        statusHistory: {
          previous: order.status,
          next: "Cancelled",
          at: now,
          actor: actor(user),
          reason: reason.trim(),
        },
      },
      $inc: { lifecycleVersion: 1 },
    },
    { new: true, runValidators: true }
  ).lean();
  if (!updated) throw new AppError("Order changed; refresh and retry cancellation.", 409, "ORDER_VERSION_CONFLICT");
  return updated;
}

async function listOrders(user, query) {
  const filter = {};
  if (user.role === "delivery") {
    filter.$or = [
      { assignedDelivery: user._id },
      { assignedDelivery: null, status: "Ready for Delivery" },
    ];
  }
  const { from, to, status } = query;
  if (from || to) {
    filter["delivery.date"] = {};
    if (from) filter["delivery.date"].$gte = from;
    if (to) filter["delivery.date"].$lte = to;
  }
  if (status) filter.status = status;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ "delivery.date": 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

async function listManagerPickupOrders() {
  return Order.find({ "delivery.method": "pickup", status: { $nin: ["Delivered", "Cancelled"] } })
    .sort({ "delivery.date": 1, createdAt: 1 }).limit(500).lean();
}

async function completeManagerPickup(orderId, user) {
  const order = await Order.findOne({ orderId, "delivery.method": "pickup" });
  if (!order) throw new AppError("Store pickup order not found.", 404, "PICKUP_ORDER_NOT_FOUND");
  if (["Delivered", "Cancelled"].includes(order.status)) throw new AppError("This pickup order is already complete or cancelled.", 409, "PICKUP_ORDER_CLOSED");
  const now = new Date();
  const paymentAlreadyPaid = order.payment?.status === "paid";
  const collectedAmount = Number(order.pricing?.total || 0);
  const paymentMethod = order.payment?.method === "cod"
    ? "cash"
    : order.payment?.method || "cash";
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status, lifecycleVersion: order.lifecycleVersion, "delivery.method": "pickup" },
    {
      $set: {
        status: "Delivered",
        statusUpdatedAt: now,
        ...(!paymentAlreadyPaid ? {
          "payment.status": "paid",
          "payment.collectedAmount": collectedAmount,
          "payment.method": paymentMethod,
          "payment.recordedBy": actor(user),
          "payment.recordedAt": now,
        } : {}),
      },
      $push: {
        statusHistory: { previous: order.status, next: "Delivered", at: now, actor: actor(user), reason: "Customer collected store pickup" },
        ...(!paymentAlreadyPaid ? {
          paymentHistory: {
            previous: order.payment?.status || "pending",
            next: "paid",
            amount: collectedAmount,
            method: paymentMethod,
            at: now,
            actor: actor(user),
          },
        } : {}),
      },
      $inc: { lifecycleVersion: 1 },
    },
    { new: true, runValidators: true }
  ).lean();
  if (!updated) throw new AppError("Order changed. Refresh and retry.", 409, "ORDER_VERSION_CONFLICT");
  return updated;
}

async function requestCancellation(orderId, body, user) {
  return cancelOrder(orderId, body.reason, user);
}

async function decideCancellation(orderId, decision, reason, user) {
  const order = await Order.findOne({ orderId, "cancellation.decision": "pending" });
  if (!order) throw new AppError("No pending cancellation request exists.", 404, "CANCELLATION_NOT_FOUND");
  const approved = decision === "approve";
  const nextStatus = approved ? "Cancelled" : order.status;
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status, lifecycleVersion: order.lifecycleVersion, "cancellation.decision": "pending" },
    { $set: {
      "cancellation.decision": approved ? "approved" : "rejected",
      "cancellation.decidedBy": actor(user), "cancellation.decidedAt": new Date(),
      "cancellation.decisionReason": reason || "", ...(approved ? { status: nextStatus, statusUpdatedAt: new Date(), cancelledAt: new Date() } : {}),
    },
    ...(approved ? { $push: { statusHistory: { previous: order.status, next: nextStatus, at: new Date(), actor: actor(user), reason: order.cancellation.reason } } } : {}),
    $inc: { lifecycleVersion: 1 },
    }, { new: true, runValidators: true }).lean();
  if (!updated) throw new AppError("Order changed while resolving cancellation.", 409, "ORDER_VERSION_CONFLICT");
  return updated;
}

async function recordPayment(orderId, amount, method, user) {
  const order = await Order.findOne({ orderId });
  if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  if (user.role === "delivery" && String(order.assignedDelivery || "") !== String(user._id)) {
    throw new AppError("This order is not assigned to you.", 403, "ORDER_NOT_ASSIGNED");
  }
  if (user.role === "delivery" && order.status !== "Delivered") {
    throw new AppError("Payment can only be recorded after the order is delivered.", 409, "ORDER_NOT_DELIVERED");
  }
  if (String(order.payment?.status || "").toLowerCase() === "paid") throw new AppError("Payment has already been recorded.", 409, "PAYMENT_ALREADY_RECORDED");
  if (!Number.isFinite(Number(order.pricing?.total)) || Number(amount) !== Number(order.pricing.total)) {
    throw new AppError("Collected amount must match the order total.", 400, "PAYMENT_AMOUNT_MISMATCH");
  }
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status, "payment.status": { $ne: "paid" }, lifecycleVersion: order.lifecycleVersion },
    { $set: { "payment.status": "paid", "payment.collectedAmount": amount, "payment.method": method, "payment.recordedBy": actor(user), "payment.recordedAt": new Date() },
      $push: { paymentHistory: { previous: order.payment?.status || "pending", next: "paid", amount, method, at: new Date(), actor: actor(user) } },
      $inc: { lifecycleVersion: 1 } },
    { new: true, runValidators: true }).lean();
  if (!updated) throw new AppError("Payment or order changed. Refresh and retry.", 409, "PAYMENT_CONFLICT");
  return updated;
}

async function recordDeliveryAttempt(orderId, reason, resolution, user) {
  const order = await Order.findOne({ orderId });
  if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  if (user.role === "delivery" && String(order.assignedDelivery || "") !== String(user._id)) {
    throw new AppError("This order is not assigned to you.", 403, "ORDER_NOT_ASSIGNED");
  }
  if (order.status !== "Out for Delivery") throw new AppError("Only an out-for-delivery order can record a failed attempt.", 409, "INVALID_TRANSITION");
  const nextStatus = resolution === "return" ? "Returned to Bakery" : "Delivery Failed";
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: "Out for Delivery", lifecycleVersion: order.lifecycleVersion },
    { $set: { status: nextStatus, statusUpdatedAt: new Date() },
      $push: {
        statusHistory: { previous: order.status, next: nextStatus, at: new Date(), actor: actor(user), reason },
        deliveryAttempts: { at: new Date(), actor: actor(user), reason, resolution },
      }, $inc: { lifecycleVersion: 1 } },
    { new: true, runValidators: true }).lean();
  if (!updated) throw new AppError("Order changed. Refresh and retry.", 409, "ORDER_VERSION_CONFLICT");
  return updated;
}

module.exports = { TRANSITIONS, getDeliveryStart, assertCustomerCanEditDelivery, assertCustomerCanCancelDelivery, listOrders, listManagerPickupOrders, completeManagerPickup, transition, cancelOrder, updateOrderDetails, requestCancellation, decideCancellation, recordPayment, recordDeliveryAttempt };
