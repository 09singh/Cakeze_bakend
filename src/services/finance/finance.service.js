const mongoose = require("mongoose");
const Order = require("../orders/order.model");
const AppError = require("../../utils/AppError");

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "Asia/Kolkata";
const startOfDay = (value) => value ? new Date(`${value}T00:00:00.000+05:30`) : null;
const endExclusive = (value) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000+05:30`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
};
const inRange = (date, from, toExclusive) => {
  const value = date ? new Date(date) : null;
  return Boolean(value && !Number.isNaN(value.getTime()) && (!from || value >= from) && (!toExclusive || value < toExclusive));
};
const paidAmount = (order) => order.payment?.status === "paid"
  ? Number(order.payment?.collectedAmount ?? order.pricing?.total ?? 0)
  : 0;
const actorDetails = (user) => ({
  userId: user?._id,
  role: user?.role || "admin",
  name: user?.name || user?.email || "Admin",
});


function reconcileReceipts(receipts, { type = "all", mode = "all" } = {}) {
  const filteredReceipts = receipts.filter((entry) => {
    const matchesType =
      type === "all" ||
      String(entry.type || "").toLowerCase() === type;

    const entryMode = String(entry.mode || "").toLowerCase();

    const matchesMode =
      mode === "all" ||
      (mode === "other" &&
        !["cash", "cod", "upi"].includes(entryMode)) ||
      (mode === "cash" &&
        ["cash", "cod"].includes(entryMode)) ||
      entryMode === mode;

    return matchesType && matchesMode;
  });

  const totals = filteredReceipts.reduce(
    (result, entry) => {
      const amount = Number(entry.amount || 0);
      const method = String(entry.mode || "").toLowerCase();

      result.total += amount;

      if (method === "upi") {
        result.upi += amount;
      } else if (["cash", "cod"].includes(method)) {
        result.cash += amount;
      } else {
        result.other += amount;
      }

      if (entry.receivedByRole === "delivery") {
        result.driver += amount;
      }

      return result;
    },
    { total: 0, upi: 0, cash: 0, other: 0, driver: 0 }
  );

  return { items: filteredReceipts, totals };
}

function invoiceDetails(order) {
  if (!order) return null;
  return {
    orderId: order.orderId,
    invoiceNumber: order.invoiceNumber || `POS-${order.orderId}`,
    phone: order.phone,
    customerName: order.customerName || "Customer",
    gstin: order.gstin || "",
    productName: order.productName,
    size: order.size,
    weight: order.weight,
    flavour: order.flavour,
    quantity: order.quantity || 1,
    addons: order.addons || [],
    delivery: order.delivery || {},
    pricing: order.pricing || {},
    payment: order.payment || {},
    coupon: order.coupon || {},
    createdAt: order.createdAt,
    status: order.status,
  };
}

async function getFinanceInvoice(orderId) {
  const order = await Order.findOne({ orderId }).lean();
  if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  return invoiceDetails(order);
}

async function createFinanceAdjustment(orderId, input, user) {
  const order = await Order.findOne({ orderId });
  if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError("Enter an amount greater than zero.", 400, "INVALID_ADJUSTMENT_AMOUNT");
  const records = Array.isArray(order.refunds) ? order.refunds : [];
  const recordedTotal = records.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const orderTotal = Number(order.pricing?.total || 0);
  if (recordedTotal + amount > orderTotal) throw new AppError("Credit notes and refunds cannot exceed the order total.", 400, "ADJUSTMENT_EXCEEDS_ORDER_TOTAL");

  if (input.kind === "refund") {
    const received = paidAmount(order);
    const refunded = records.filter((record) => record.kind === "refund" && record.status === "Refunded")
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    if (received <= 0 || refunded + amount > received) throw new AppError("Refund cannot exceed the amount already collected for this order.", 400, "REFUND_EXCEEDS_COLLECTED");
  }

  const record = {
    id: new mongoose.Types.ObjectId().toString(),
    kind: input.kind,
    amount,
    reason: input.reason.trim(),
    status: input.kind === "refund" ? "Refunded" : "Issued",
    method: input.kind === "refund" ? input.method : "",
    date: new Date(),
    actor: actorDetails(user),
  };
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, lifecycleVersion: order.lifecycleVersion },
    { $push: { refunds: record }, $inc: { lifecycleVersion: 1 } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw new AppError("Order changed. Refresh and retry.", 409, "ORDER_VERSION_CONFLICT");
  return { ...record, orderId: updated.orderId, customerName: updated.customerName || "Customer", phone: updated.phone };
}

async function getFinanceData({ from, to, type = "all", mode = "all" }) {
  const fromDate = startOfDay(from);
  const toDateExclusive = endExclusive(to);
  const orders = await Order.find({ status: { $ne: "Cancelled" } })
    .select("orderId invoiceNumber phone customerName gstin productName size weight flavour quantity addons delivery payment paymentHistory refunds pricing coupon createdBy createdAt status statusUpdatedAt")
    .sort({ createdAt: -1 })
    .lean();

  const inDate = (date) => inRange(date, fromDate, toDateExclusive);
  const isAdminOrder = (order) => order.createdBy?.role === "admin";
  const matchesType = (order) => type === "all" || !["admin", "website"].includes(type) || (type === "admin" ? isAdminOrder(order) : !isAdminOrder(order));
  const invoiceRows = orders.filter((order) => {
    if (!inDate(order.createdAt) || !matchesType(order)) return false;
    if (type === "cash" && !["cash", "cod"].includes(order.payment?.method)) return false;
    if (type === "upi" && order.payment?.method !== "upi") return false;
    return true;
  }).map((order) => ({
    orderId: order.orderId,
    invoiceNumber: order.invoiceNumber || `POS-${order.orderId}`,
    customerName: order.customerName || "Customer",
    phone: order.phone,
    productName: order.productName,
    date: order.createdAt,
    type: isAdminOrder(order) ? "Admin" : "Website",
    mode: order.payment?.method || "cod",
    status: order.status,
    total: Number(order.pricing?.total || 0),
    discount: Number(order.pricing?.discount || 0),
    couponCode: order.coupon?.code || "",
  }));

  const receipts = [];
  for (const order of orders) {
    const history = Array.isArray(order.paymentHistory) ? order.paymentHistory : [];
    const events = history.length ? history : (order.payment?.status === "paid" && order.payment?.recordedAt
      ? [{ amount: order.payment.collectedAmount ?? order.pricing?.total, method: order.payment.method, at: order.payment.recordedAt, actor: order.payment.recordedBy }]
      : []);
    for (const event of events) {
      if (!inDate(event.at)) continue;
      const amount = Number(event.amount || 0);
      const method = String(event.method || "cash").toLowerCase();
      receipts.push({
        orderId: order.orderId,
        customerName: order.customerName || "Customer",
        phone: order.phone,
        date: event.at,
        type: isAdminOrder(order) ? "Admin" : "Website",
        mode: method,
        transactionType: "Payment",
        receivedBy: event.actor?.name || event.actor?.role || "—",
        receivedByRole: event.actor?.role || "",
        amount,
      });
    } 
    for (const refund of order.refunds || []) {
      if (refund.kind !== "refund" || refund.status !== "Refunded" || !inDate(refund.date || refund.createdAt)) continue;
      receipts.push({
        orderId: order.orderId,
        customerName: order.customerName || "Customer",
        phone: order.phone,
        date: refund.date || refund.createdAt,
        type: isAdminOrder(order) ? "Admin" : "Website",
        mode: String(refund.method || "cash").toLowerCase(),
        transactionType: "Refund",
        receivedBy: refund.actor?.name || refund.actor?.role || "Admin",
        receivedByRole: refund.actor?.role || "admin",
        amount: -Number(refund.amount || 0),
      });
    }
  }
  receipts.sort((a, b) => new Date(b.date) - new Date(a.date));
  // Keep summary cards independent of the selected payment mode.
  const { items: filteredReceipts, totals } = reconcileReceipts(receipts, { type, mode });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE }).format(new Date());
  const outstanding = orders.filter((order) => {
    if (order.status !== "Delivered") return false;
    const dueDate = order.delivery?.date;
    if (from && (!dueDate || dueDate < from)) return false;
    if (to && (!dueDate || dueDate > to)) return false;
    return Number(order.pricing?.total || 0) - paidAmount(order) > 0;
  }).map((order) => {
    const total = Number(order.pricing?.total || 0);
    const collected = paidAmount(order);
    return {
      orderId: order.orderId,
      customerName: order.customerName || "Customer",
      phone: order.phone,
      deliveryDate: order.delivery?.date || "",
      deliveryTime: order.delivery?.time || "",
      total,
      collected,
      outstanding: Math.max(0, total - collected),
      overdue: Boolean(order.delivery?.date && order.delivery.date < today),
    };
  }).sort((a, b) => String(a.deliveryDate).localeCompare(String(b.deliveryDate)));

  const creditNotes = [];
  for (const order of orders) {
    for (const refund of order.refunds || []) {
      const date = refund.date || refund.createdAt || refund.at;
      if (!inDate(date)) continue;
      creditNotes.push({
        id: refund.id || refund._id?.toString?.() || `${order.orderId}-${new Date(date).getTime()}`,
        orderId: order.orderId,
        customerName: order.customerName || "Customer",
        phone: order.phone,
        date,
        kind: refund.kind || "credit-note",
        amount: Number(refund.amount ?? refund.refundAmount ?? refund.value ?? 0),
        reason: refund.reason || refund.note || "Refund",
        status: refund.status || "Recorded",
        method: refund.method || "",
      });
    }
  }

  return {
    invoices: invoiceRows,
    reconciliation: { items: filteredReceipts, totals },
    outstanding: { items: outstanding, total: outstanding.reduce((sum, item) => sum + item.outstanding, 0) },
    creditNotes: creditNotes.sort((a, b) => new Date(b.date) - new Date(a.date)),
    storeCredits: [],
    filters: { from: from || null, to: to || null, type, mode },
  };
}

module.exports = { getFinanceData, getFinanceInvoice, createFinanceAdjustment, reconcileReceipts };
