const bcrypt = require('bcryptjs');
const User = require('./auth.model');
const otpProvider = require('./otp.provider');
const AppError = require('../../utils/AppError');
const { signToken, revokeToken } = require('../../utils/jwt');

const normalizePhone = (value) => (typeof value === 'string' ? value.replace(/\s+/g, '').trim() : '');
const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id.toString(),
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function requestCustomerOtp(phoneNumber) {
  const phone = normalizePhone(phoneNumber);

  if (!phone) {
    throw new AppError('Phone number is required.', 400, 'PHONE_REQUIRED');
  }

  let user = await User.findOne({ phone });

  if (!user) {
    user = await User.create({
      name: 'Customer',
      phone,
      role: 'customer',
      isActive: true,
    });
  }

  await otpProvider.sendOtp({ phone });

  return {
    message: 'OTP sent successfully. Please check the code to continue.',
    user: sanitizeUser(user),
  };
}

async function verifyCustomerOtp(phoneNumber, otpCode) {
  const phone = normalizePhone(phoneNumber);

  if (!phone) {
    throw new AppError('Phone number is required.', 400, 'PHONE_REQUIRED');
  }

  if (!otpCode || !/^\d{4,6}$/.test(String(otpCode))) {
    throw new AppError('A valid OTP is required.', 400, 'OTP_INVALID');
  }

  await otpProvider.verifyOtp({ phone, otp: otpCode });

  const user = await User.findOne({ phone });

  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  user.isActive = true;
  await user.save();

  const token = signToken({
    sub: user._id.toString(),
    role: user.role,
    type: 'customer',
  });

  return {
    user: sanitizeUser(user),
    token,
    tokenType: 'Bearer',
  };
}

async function staffLogin(email, password) {
  const cleanEmail = normalizeEmail(email);

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new AppError('Invalid email or password.', 401, 'AUTH_INVALID_CREDENTIALS');
  }

  if (!password || String(password).length < 8) {
    throw new AppError('Invalid email or password.', 401, 'AUTH_INVALID_CREDENTIALS');
  }

 const user = await User.findOne({ email: cleanEmail }).select('+passwordHash');

if (
  !user ||
  !['admin', 'kitchen', 'delivery'].includes(user.role)
) {
  throw new AppError(
    'Invalid email or password.',
    401,
    'AUTH_INVALID_CREDENTIALS'
  );
}

  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    throw new AppError('Invalid email or password.', 401, 'AUTH_INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    throw new AppError('Your account has been disabled.', 403, 'ACCOUNT_DISABLED');
  }

  const token = signToken({
    sub: user._id.toString(),
    role: user.role,
    type: 'staff',
  });

  return {
    user: sanitizeUser(user),
    token,
    tokenType: 'Bearer',
  };
}

async function registerStaffUser({ name, email, password, role = 'admin' }) {
  const cleanEmail = normalizeEmail(email);

  if (!cleanEmail) {
    throw new AppError('Email is required.', 400, 'EMAIL_REQUIRED');
  }

  if (!password || String(password).length < 8) {
    throw new AppError('Password must be at least 8 characters long.', 400, 'PASSWORD_WEAK');
  }

  if (!['admin', 'kitchen', 'delivery'].includes(role)) {
    throw new AppError('Invalid staff role.', 400, 'INVALID_ROLE');
  }

  const existingUser = await User.findOne({ email: cleanEmail });

  if (existingUser) {
    throw new AppError('A staff account with this email already exists.', 409, 'EMAIL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await User.create({
    name: name || cleanEmail.split('@')[0],
    email: cleanEmail,
    passwordHash,
    role,
    isActive: true,
  });

  return sanitizeUser(user);
}

async function getAuthenticatedUser(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  if (!user.isActive) {
    throw new AppError('Your account is disabled.', 403, 'ACCOUNT_DISABLED');
  }

  return sanitizeUser(user);
}

function logoutUser(token) {
  revokeToken(token);

  return {
    message: 'Logged out successfully.',
  };
}

module.exports = {
  requestCustomerOtp,
  verifyCustomerOtp,
  staffLogin,
  registerStaffUser,
  getAuthenticatedUser,
  logoutUser,
  sanitizeUser,
};
