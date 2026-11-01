const service = require("./order.service");
const Order = require("./order.model");
const lifecycle = require("./order.lifecycle");
const AppError = require("../../utils/AppError");
const { emailOtpService } = require("../auth/emailOtp.service");

const send = (res, data, status = 200) => res.status(status).json({ success: true, data });

const createCustomerOrder = async (req, res, next) => {
  try {
    const { customerEmail, emailVerificationToken, ...orderData } = req.body;
    const verified = await emailOtpService.validateToken(
      emailVerificationToken,
      customerEmail,
      orderData.checkoutId
    );
    return send(res, await service.createCustomerOrder({
      ...orderData,
      customerEmail: verified.email,
    }, req.user), 201);
  } catch (error) { return next(error); }
};

const createEmailVerifiedOrder = async (req, res, next) => {
  try {
    const { customerEmail, emailVerificationToken, ...orderData } = req.body;
    const verified = await emailOtpService.validateToken(
      emailVerificationToken,
      customerEmail,
      orderData.checkoutId
    );
    return send(res, await service.createGuestOrder({
      ...orderData,
      customerEmail: verified.email,
    }), 201);
  } catch (error) { return next(error); }
};

const createVerifiedSharedOrder = async (req, res, next) => {
  try {
    const { customerEmail, emailVerificationToken, ...orderData } = req.body;
    const verified = await emailOtpService.validateToken(
      emailVerificationToken,
      customerEmail,
      orderData.checkoutId
    );
    return send(res, await service.createSharedOrder(orderData, null, verified.email), 201);
  } catch (error) { return next(error); }
};

const createAdminOrder = async (req, res, next) => {
  try { return send(res, await service.createAdminOrder(req.body, req.user), 201); }
  catch (error) { return next(error); }
};

const createSharedOrder = async (req, res, next) => {
  try {
    const { customerEmail, emailVerificationToken, ...orderData } = req.body;
    const verified = await emailOtpService.validateToken(
      emailVerificationToken,
      customerEmail,
      orderData.checkoutId
    );
    return send(res, await service.createSharedOrder(orderData, req.user, verified.email), 201);
  }
  catch (error) { return next(error); }
};

const updateCustomerDetails = async (req, res, next) => {
  try {
    const { version, ...details } = req.body;
    return send(res, await lifecycle.updateOrderDetails(
      req.params.orderId,
      details,
      { expectedVersion: version, user: req.user }
    ));
  } catch (error) { return next(error); }
};

const updateAdminDetails = async (req, res, next) => {
  try {
    const { version, ...details } = req.body;
    return send(res, await lifecycle.updateOrderDetails(
      req.params.orderId,
      details,
      { user: req.user, expectedVersion: version, admin: true }
    ));
  } catch (error) { return next(error); }
};

const listCustomerOrders = async (req, res, next) => {
  try {
    const filter = req.user?._id
      ? { customer: req.user._id }
      : { customerEmail: req.user.email };
    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();
    return send(res, orders);
  } catch (error) { return next(error); }
};

const listEmailOrders = async (req, res, next) => {
  try {
    const { customerEmail, emailVerificationToken, checkoutId } = req.body || {};
    const verified = await emailOtpService.validateToken(
      emailVerificationToken,
      customerEmail,
      checkoutId
    );
    const orders = await Order.find({ customerEmail: verified.email })
      .sort({ createdAt: -1 })
      .lean();
    return send(res, orders);
  } catch (error) { return next(error); }
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

const listManagerPickups = async (req, res, next) => {
  try { return send(res, await lifecycle.listManagerPickupOrders()); }
  catch (error) { return next(error); }
};

const completeManagerPickup = async (req, res, next) => {
  try { return send(res, await lifecycle.completeManagerPickup(req.params.orderId, req.user)); }
  catch (error) { return next(error); }
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
    const { reason } = req.body || {};
    if (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 500) {
      throw new AppError("A valid cancellation reason is required.", 400, "INVALID_CANCELLATION");
    }
    let customer = req.user;
    if (customer?.role !== "customer") {
      const { customerEmail, emailVerificationToken, checkoutId } = req.body || {};
      if (!customerEmail || !emailVerificationToken || !checkoutId) {
        throw new AppError("Verify the email linked to this order before cancelling it.", 401, "EMAIL_VERIFICATION_REQUIRED");
      }
      const verified = await emailOtpService.validateToken(
        emailVerificationToken,
        customerEmail,
        checkoutId
      );
      customer = { role: "customer", email: verified.email };
    }
    return send(res, await lifecycle.requestCancellation(req.params.orderId, { reason: reason.trim() }, customer));
  } catch (error) { return next(error); }
};

const cancelOrder = async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 500) {
      throw new AppError("A valid cancellation reason is required.", 400, "INVALID_CANCELLATION");
    }
    return send(res, await lifecycle.cancelOrder(req.params.orderId, reason.trim(), req.user));
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

module.exports = { createCustomerOrder, createEmailVerifiedOrder, createVerifiedSharedOrder, createAdminOrder, createSharedOrder, updateCustomerDetails, updateAdminDetails, listCustomerOrders, listEmailOrders, listOrders, listManagerPickups, completeManagerPickup, updateStatus, requestCancellation, cancelOrder, decideCancellation, recordPayment, recordDeliveryAttempt, assignDelivery, adminOverride };
