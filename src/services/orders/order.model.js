const mongoose = require("mongoose");

const addonSnapshotSchema = new mongoose.Schema(
  {
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon", required: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    checkoutId: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true, index: true },
    customerName: { type: String, trim: true, default: "", maxlength: 100 },
    gstin: { type: String, trim: true, uppercase: true, default: "", maxlength: 15 },
    createdBy: { type: mongoose.Schema.Types.Mixed, default: null },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true, trim: true },
    productImage: { type: String, default: "" },
    category: { type: String, default: "" },
    size: { type: String, required: true, trim: true },
    weight: { type: Number, required: true, min: 0 },
    flavour: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    customisation: {
      nameOnCake: { type: String, default: "" },
      messageOnCake: { type: String, default: "" },
      colourChange: { type: String, default: "" },
      addPhoto: { type: String, default: "" },
      otherRequest: { type: String, default: "" },
      referenceImage: { type: String, default: "" },
      referenceImages: { type: [String], default: [] },
      theme: { type: String, default: "" },
      designNotes: { type: String, default: "" },
      tiers: { type: Number, min: 1, max: 6, default: null },
      hasAllergy: { type: Boolean, default: false },
      allergyNotes: { type: String, default: "" },
      paymentPreference: { type: String, enum: ["cash", "upi"], default: "cash" },
    },
    addons: { type: [addonSnapshotSchema], default: [] },
    delivery: {
      method: { type: String, enum: ["delivery", "pickup"], required: true },
      date: { type: String, required: true },
      time: { type: String, required: true },
      address: { type: String, default: "" },
    },
    pricing: {
      cakePrice: { type: Number, required: true, min: 0 },
      addonsTotal: { type: Number, required: true, min: 0 },
      deliveryFee: { type: Number, required: true, min: 0 },
      subtotal: { type: Number, required: true, min: 0 },
      discount: { type: Number, required: true, min: 0 },
      total: { type: Number, required: true, min: 0 },
    },
    coupon: {
      code: { type: String, default: null },
      discountType: { type: String, default: null },
      discountValue: { type: Number, default: 0 },
    },
    payment: {
      method: { type: String, enum: ["cod", "cash", "upi", "card", "netbanking", "wallet"], required: true },
      status: { type: String, enum: ["pending", "paid"], default: "pending" },
      collectedAmount: { type: Number, min: 0, default: null },
      recordedBy: { type: mongoose.Schema.Types.Mixed, default: null },
      recordedAt: { type: Date, default: null },
    },
    status: { type: String, default: "Confirmed", index: true },
    statusUpdatedAt: { type: Date, default: Date.now, index: true },
    cancelledAt: { type: Date, default: null, index: true },
    refunds: { type: [mongoose.Schema.Types.Mixed], default: [] },
    lifecycleVersion: { type: Number, default: 0 },
    assignedDelivery: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    cancellation: { type: mongoose.Schema.Types.Mixed, default: undefined },
    statusHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    paymentHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    deliveryAttempts: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true, versionKey: false }
);

orderSchema.index({ phone: 1, orderId: 1 }, { unique: true });
orderSchema.index({ "delivery.date": 1, status: 1 });
orderSchema.index({ assignedDelivery: 1, status: 1 });

module.exports = mongoose.model("Order", orderSchema);



