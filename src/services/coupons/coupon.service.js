const mongoose = require("mongoose");
const Coupon = require("./coupon.model");
const AppError = require("../../utils/AppError");

const LEGACY_COUPONS = [
  { code: "WELCOME10", discountValue: 10 },
  { code: "CAKE15", discountValue: 15 },
  { code: "BIRTHDAY20", discountValue: 20 },
];

async function seedLegacyCoupons() {
  if (await Coupon.exists({})) return;
  await Coupon.insertMany(LEGACY_COUPONS.map((coupon) => ({ ...coupon, discountType: "percentage", isActive: true })), { ordered: false });
}

function eligibleFilter(code, now = new Date()) {
  return {
    code,
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }] },
      { $or: [{ usageLimit: null }, { $expr: { $lt: ["$redemptionCount", "$usageLimit"] } }] },
    ],
  };
}

async function validateCoupon(code) {
  const normalized = String(code || "").trim().toUpperCase();
  const coupon = await Coupon.findOne(eligibleFilter(normalized)).select("code discountType discountValue").lean();
  if (!coupon) throw new AppError("This coupon is invalid, expired, or no longer available.", 400, "INVALID_COUPON");
  return coupon;
}

async function reserveCoupon(code) {
  const normalized = String(code || "").trim().toUpperCase();
  const coupon = await Coupon.findOneAndUpdate(eligibleFilter(normalized), { $inc: { redemptionCount: 1 } }, { new: true, projection: { code: 1, discountType: 1, discountValue: 1 } }).lean();
  if (!coupon) throw new AppError("This coupon is invalid, expired, or no longer available.", 400, "INVALID_COUPON");
  return coupon;
}

async function releaseCoupon(code) {
  if (code) await Coupon.updateOne({ code: String(code).trim().toUpperCase(), redemptionCount: { $gt: 0 } }, { $inc: { redemptionCount: -1 } });
}

async function listCoupons() {
  await seedLegacyCoupons();
  return Coupon.find({}).sort({ createdAt: -1, code: 1 }).lean();
}

async function createCoupon(data) {
  const normalized = { ...data, code: data.code.trim().toUpperCase() };
  if (normalized.startsAt && normalized.expiresAt && normalized.startsAt >= normalized.expiresAt) {
    throw new AppError("Expiry date must be after the start date.", 400, "INVALID_COUPON_DATES");
  }
  try { return await Coupon.create(normalized); }
  catch (error) {
    if (error.code === 11000) throw new AppError("A coupon with this code already exists.", 409, "COUPON_CODE_EXISTS");
    throw error;
  }
}

async function updateCoupon(id, isActive) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError("Invalid coupon ID.", 400, "INVALID_COUPON_ID");
  const coupon = await Coupon.findByIdAndUpdate(id, { $set: { isActive } }, { new: true, runValidators: true }).lean();
  if (!coupon) throw new AppError("Coupon not found.", 404, "COUPON_NOT_FOUND");
  return coupon;
}

module.exports = { seedLegacyCoupons, validateCoupon, reserveCoupon, releaseCoupon, listCoupons, createCoupon, updateCoupon };
