const Order = require("./order.model");
const AppError = require("../../utils/AppError");

const TRANSITIONS = {
  "Pending Payment": ["Confirmed", "Cancelled"],
  Confirmed: ["Preparing", "Cancelled"],
  Preparing: ["Ready for Delivery"],
  "Ready for Delivery": ["Out for Delivery", "Cancelled"],
  "Out for Delivery": ["Delivered", "Delivery Failed"],
  "Delivery Failed": ["Out for Delivery", "Returned to Bakery"],
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

async function transition(orderId, next, user, { reason = "", expectedVersion, override = false } = {}) {
  const order = await Order.findOne({ orderId });
  if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  if (user.role === "kitchen" && !((order.status === "Confirmed" && next === "Preparing") || (order.status === "Preparing" && next === "Ready for Delivery"))) throw new AppError("Kitchen staff cannot make this status change.", 403, "FORBIDDEN");
  if (user.role === "delivery" && !(["Ready for Delivery", "Delivery Failed", "Out for Delivery"].includes(order.status) && ["Out for Delivery", "Delivered", "Delivery Failed", "Returned to Bakery"].includes(next))) throw new AppError("Delivery staff cannot make this status change.", 403, "FORBIDDEN");
  if (!override && !(TRANSITIONS[order.status] || []).includes(next)) {
    throw new AppError("This order status transition is not allowed.", 409, "INVALID_TRANSITION");
  }
  if (override && !reason.trim()) throw new AppError("A reason is required for an admin override.", 400, "REASON_REQUIRED");
  const filter = expectedFilter(order, expectedVersion);
  const shouldClaimDelivery = user.role === "delivery" &&
    !order.assignedDelivery && order.status === "Ready for Delivery" && next === "Out for Delivery";
  if (user.role === "delivery" && !shouldClaimDelivery && String(order.assignedDelivery || "") !== String(user._id)) {
    throw new AppError("This order is not assigned to you.", 403, "ORDER_NOT_ASSIGNED");
  }
  if (shouldClaimDelivery) filter.assignedDelivery = null;
  const extra = override ? { adminOverride: true } : {};
  if (shouldClaimDelivery) extra.assignedDelivery = user._id;
  if (override && next === "Cancelled") {
    extra.cancelledAt = new Date();
    extra.cancellation = { requestedBy: user._id, reason, requestedAt: new Date(), decision: "approved", decidedBy: actor(user), decidedAt: new Date(), operationalOutcome: order.status };
  }
  const update = withHistory(order.status, next, user, reason, extra);
  const updated = await Order.findOneAndUpdate(filter, update, { new: true, runValidators: true }).lean();
  if (!updated) throw new AppError("Order changed since it was loaded. Refresh and retry.", 409, "ORDER_VERSION_CONFLICT");
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

async function requestCancellation(orderId, body, user) {
  const order = await Order.findOne({ orderId, phone: body.phone.replace(/\D/g, "") });
  if (!order) throw new AppError("No order matched that phone number and reference.", 404, "ORDER_NOT_FOUND");
  if (!["Pending Payment", "Confirmed"].includes(order.status)) {
    if (!["Preparing", "Ready for Delivery", "Out for Delivery"].includes(order.status)) {
      throw new AppError("This order cannot be cancelled in its current state.", 409, "CANCELLATION_NOT_ALLOWED");
    }
  } else {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status, cancellation: { $exists: false } },
      {
        $set: { status: "Cancelled", statusUpdatedAt: new Date(), cancelledAt: new Date(),
          cancellation: { requestedBy: user?._id || "customer", reason: body.reason, requestedAt: new Date(), decision: "approved", decidedAt: new Date() } },
        $push: { statusHistory: { previous: order.status, next: "Cancelled", at: new Date(), actor: { userId: user?._id || null, role: user?.role || "customer" }, reason: body.reason } },
        $inc: { lifecycleVersion: 1 },
      }, { new: true, runValidators: true }).lean();
    if (!updated) throw new AppError("Order changed; reload and retry cancellation.", 409, "ORDER_VERSION_CONFLICT");
    return updated;
  }
  if (order.cancellation?.decision === "pending") throw new AppError("A cancellation request is already pending.", 409, "CANCELLATION_PENDING");
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status, lifecycleVersion: order.lifecycleVersion },
    { $set: { cancellation: { requestedBy: user?._id || "customer", reason: body.reason, requestedAt: new Date(), decision: "pending" } }, $inc: { lifecycleVersion: 1 } },
    { new: true, runValidators: true }).lean();
  if (!updated) throw new AppError("Order changed; reload and retry cancellation.", 409, "ORDER_VERSION_CONFLICT");
  return updated;
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
  if (order.payment?.method !== "cod") throw new AppError("Only COD collection can be recorded through this endpoint.", 409, "COD_ONLY");
  if (order.payment?.status === "paid") throw new AppError("Payment has already been recorded.", 409, "PAYMENT_ALREADY_RECORDED");
  if (Number(amount) !== Number(order.pricing.total)) throw new AppError("Collected amount must match the order total.", 400, "PAYMENT_AMOUNT_MISMATCH");
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

module.exports = { TRANSITIONS, listOrders, transition, requestCancellation, decideCancellation, recordPayment, recordDeliveryAttempt };



