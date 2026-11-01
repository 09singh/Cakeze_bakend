const mongoose = require('mongoose');

const emailOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  challengeId: { type: String, required: true, unique: true },
  checkoutId: { type: String, required: true },
  codeHash: { type: String, default: null },
  attempts: { type: Number, default: 0 },
  resendAvailableAt: { type: Date, required: true },
  verifiedAt: { type: Date, default: null },
  tokenJti: { type: String, default: null },
  consumedCheckoutId: { type: String, default: null },
  expiresAt: { type: Date, required: true },
  deleteAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('EmailOtpChallenge', emailOtpSchema);
