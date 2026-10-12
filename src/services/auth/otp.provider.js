const crypto = require('crypto');
const AppError = require('../../utils/AppError');

const otpStore = new Map();
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

class DevelopmentOtpProvider {
  generateOtp() {
   generateOtp() 
   return String(Math.floor(100000 + Math.random() * 900000));

  }

  hashOtp(otp) {
    return crypto.createHash('sha256').update(String(otp)).digest('hex');
  }

  async sendOtp({ phone }) {
    if (!phone) {
      throw new AppError('Phone number is required for OTP delivery.', 400, 'PHONE_REQUIRED');
    }

    const otp = this.generateOtp();
    const expiresAt = Date.now() + OTP_TTL_MINUTES * 60 * 1000;

    otpStore.set(phone, {
      otpHash: this.hashOtp(otp),
      expiresAt,
      attempts: 0,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV OTP] phone=${phone} otp=${otp}`);
    }

    return { otp, success: true };
  }

  async verifyOtp({ phone, otp }) {
    if (!phone || !otp) {
      throw new AppError('Phone number and OTP are required.', 400, 'OTP_REQUIRED');
    }

    const record = otpStore.get(phone);

    if (!record) {
      throw new AppError('Invalid OTP.', 400, 'OTP_INVALID');
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(phone);
      throw new AppError('OTP expired. Please request a new one.', 400, 'OTP_EXPIRED');
    }

    record.attempts += 1;

    if (record.attempts > OTP_MAX_ATTEMPTS) {
      otpStore.delete(phone);
      throw new AppError('Too many OTP attempts. Please request a new code.', 429, 'OTP_ATTEMPTS_EXCEEDED');
    }

    const expected = Buffer.from(record.otpHash, 'hex');
    const provided = Buffer.from(this.hashOtp(otp), 'hex');

    if (expected.length !== provided.length) {
      throw new AppError('Invalid OTP.', 400, 'OTP_INVALID');
    }

    const isValid = crypto.timingSafeEqual(expected, provided);

    if (!isValid) {
      throw new AppError('Invalid OTP.', 400, 'OTP_INVALID');
    }

    otpStore.delete(phone);
    return true;
  }
}

const otpProvider = new DevelopmentOtpProvider();

module.exports = otpProvider;
