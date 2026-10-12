const service = require("./order.service");
const lifecycle = require("./order.lifecycle");
const AppError = require("../../utils/AppError");

const send = (res, data, status = 200) => res.status(status).json({ success: true, data });

const createOrder = async (req, res, next) => {
  try { return send(res, await service.createGuestOrder(req.body), 201); }
  catch (error) { return next(error); }
};

const createAdminOrder = async (req, res, next) => {
  try { return send(res, await service.createAdminOrder(req.body, req.user), 201); }
  catch (error) { return next(error); }
};

const getOrder = async (req, res, next) => {
  try { return send(res, await service.getGuestOrder(req.query)); }
  catch (error) { return next(error); }
};

const listOrders = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const validDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!validDate(from) || !validDate(to) || (from && to && from > to)) {
      throw new AppError("Invalid scheduled date range.", 400, "INVALID_DATE_RANGE");
    }
    return send(res, await lifecycle.listOrders(req.user, req.query));
  } catch (error) { return next(error); }
};

const updateStatus = async (req, res, next) => {
  try {
    const updated = await lifecycle.transition(req.params.orderId, req.body.status, req.user, {
      reason: String(req.body.reason || ""),
      expectedVersion: req.body.version,
    });
    return send(res, updated);
  } catch (error) { return next(error); }
};

const requestCancellation = async (req, res, next) => {
  try {
    const { phone, reason } = req.body || {};
    if (typeof phone !== "string" || typeof reason !== "string" || reason.trim().length < 3 || reason.length > 500) {
      throw new AppError("A valid phone number and cancellation reason are required.", 400, "INVALID_CANCELLATION");
    }
    return send(res, await lifecycle.requestCancellation(req.params.orderId, { phone, reason: reason.trim() }, null));
  } catch (error) { return next(error); }
};

const decideCancellation = async (req, res, next) => {
  try {
    const { decision, reason = "" } = req.body || {};
    if (!["approve", "reject"].includes(decision) || (decision === "reject" && !String(reason).trim())) {
      throw new AppError("Choose approve or reject and provide a reason when rejecting.", 400, "INVALID_DECISION");
    }
    return send(res, await lifecycle.decideCancellation(req.params.orderId, decision, String(reason), req.user));
  } catch (error) { return next(error); }
};

const recordPayment = async (req, res, next) => {
  try {
    if (!["admin", "delivery"].includes(req.user.role)) throw new AppError("Only delivery staff or Admin can record COD collection.", 403, "FORBIDDEN");
    const { amount, method = "cash" } = req.body || {};
    if (!Number.isFinite(Number(amount)) || !["cash", "upi"].includes(method)) throw new AppError("Provide the amount collected and a supported collection method.", 400, "INVALID_PAYMENT");
    return send(res, await lifecycle.recordPayment(req.params.orderId, Number(amount), method, req.user));
  } catch (error) { return next(error); }
};

const recordDeliveryAttempt = async (req, res, next) => {
  try {
    if (req.user.role !== "delivery") throw new AppError("Only assigned delivery staff can record an attempt.", 403, "FORBIDDEN");
    const { reason, resolution = "retry" } = req.body || {};
    if (!["customer_unavailable", "incorrect_address", "customer_refused", "other"].includes(reason) || !["retry", "return"].includes(resolution)) {
      throw new AppError("Provide a valid failure reason and resolution.", 400, "INVALID_DELIVERY_ATTEMPT");
    }
    return send(res, await lifecycle.recordDeliveryAttempt(req.params.orderId, reason, resolution, req.user));
  } catch (error) { return next(error); }
};

const assignDelivery = async (req, res, next) => {
  try {
    const Order = require("./order.model");
    const User = require("../auth/auth.model");
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
    const deliveryUser = await User.findOne({ _id: req.body.deliveryUserId, role: "delivery", isActive: true }).select("_id name email").lean();
    if (!deliveryUser) throw new AppError("Active delivery staff user not found.", 404, "DELIVERY_USER_NOT_FOUND");
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status, lifecycleVersion: order.lifecycleVersion },
      { $set: { assignedDelivery: deliveryUser._id }, $push: { statusHistory: { previous: order.status, next: order.status, at: new Date(), actor: { userId: req.user._id, role: req.user.role }, reason: "Delivery assignment", assignedDelivery: deliveryUser._id } }, $inc: { lifecycleVersion: 1 } },
      { new: true, runValidators: true }).lean();
    if (!updated) throw new AppError("Order changed. Refresh and retry.", 409, "ORDER_VERSION_CONFLICT");
    return send(res, updated);
  } catch (error) { return next(error); }
};

const adminOverride = async (req, res, next) => {
  try {
    const { status, reason, version } = req.body || {};
    if (typeof status !== "string" || !String(reason || "").trim()) throw new AppError("Status and a mandatory reason are required.", 400, "INVALID_OVERRIDE");
    return send(res, await lifecycle.transition(req.params.orderId, status, req.user, { reason: String(reason).trim(), expectedVersion: version, override: true }));
  } catch (error) { return next(error); }
};

module.exports = { createOrder, createAdminOrder, getOrder, listOrders, updateStatus, requestCancellation, decideCancellation, recordPayment, recordDeliveryAttempt, assignDelivery, adminOverride };
