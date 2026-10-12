const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, minlength: 4, maxlength: 30, match: /^[A-Z0-9_-]+$/ },
  discountType: { type: String, enum: ["percentage"], default: "percentage" },
  discountValue: { type: Number, required: true, min: 1, max: 100 },
  isActive: { type: Boolean, default: true, index: true },
  startsAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  usageLimit: { type: Number, min: 1, default: null },
  redemptionCount: { type: Number, min: 0, default: 0 },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("Coupon", couponSchema);
