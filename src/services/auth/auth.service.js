const bcrypt = require('bcryptjs');
const User = require('./auth.model');
const Order = require('../orders/order.model');
const AppError = require('../../utils/AppError');
const { signToken, revokeToken } = require('../../utils/jwt');

const normalizePhone = (value) => {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
};
const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id.toString(),
    name: user.name,
    phone: user.phone,
    firebaseUid: user.firebaseUid,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function findOrCreateFirebaseCustomer(claims) {
  const phone = normalizePhone(claims.phone_number);
  if (
    typeof claims.uid !== 'string' ||
    !phone ||
    !/^\+[1-9]\d{8,14}$/.test(phone) ||
    claims.firebase?.sign_in_provider !== 'phone'
  ) {
    throw new AppError('A verified Firebase phone session is required.', 401, 'PHONE_AUTH_REQUIRED');
  }

  let user = await User.findOne({ firebaseUid: claims.uid });
  if (!user) {
    const phoneMatches = await User.find({
      phone: { $in: [phone, phone.replace(/\D/g, '')] },
    }).limit(2);
    if (phoneMatches.length > 1) {
      throw new AppError('This phone number is linked to multiple customer records.', 409, 'CUSTOMER_IDENTITY_CONFLICT');
    }
    [user] = phoneMatches;
  }

  if (user && user.role !== 'customer') {
    throw new AppError('This phone number cannot be used for a customer account.', 409, 'CUSTOMER_IDENTITY_CONFLICT');
  }
  if (user?.firebaseUid && user.firebaseUid !== claims.uid) {
    throw new AppError('This phone number is linked to another verified account.', 409, 'CUSTOMER_IDENTITY_CONFLICT');
  }
  if (user && !user.isActive) {
    throw new AppError('Your account has been disabled.', 403, 'ACCOUNT_DISABLED');
  }

  if (!user) {
    user = new User({
      name: claims.name || 'Customer',
      phone,
      firebaseUid: claims.uid,
      authProvider: 'firebase',
      role: 'customer',
      isActive: true,
    });
  } else {
    user.phone = phone;
    user.firebaseUid = claims.uid;
    user.authProvider = 'firebase';
    if (claims.name && (!user.name || user.name === 'Customer')) user.name = claims.name;
  }

  try {
    await user.save();
  } catch (error) {
    if (error.code !== 11000) throw error;
    const concurrentUser = await User.findOne({ firebaseUid: claims.uid });
    if (!concurrentUser || concurrentUser.role !== 'customer' || !concurrentUser.isActive) {
      throw new AppError('This verified phone number is already linked to another account.', 409, 'CUSTOMER_IDENTITY_CONFLICT');
    }
    user = concurrentUser;
  }

  return sanitizeUser(user);
}

async function loginCustomerByEmail(email) {
  const cleanEmail = normalizeEmail(email);
  let user = await User.findOne({ email: cleanEmail });

  if (user && user.role !== 'customer') {
    throw new AppError('This email cannot be used for a customer account.', 409, 'CUSTOMER_IDENTITY_CONFLICT');
  }
  if (user && !user.isActive) {
    throw new AppError('Your account has been disabled.', 403, 'ACCOUNT_DISABLED');
  }

  if (!user) {
    const previousOrder = await Order.findOne({ customerEmail: cleanEmail })
      .sort({ createdAt: -1 })
      .select('customerName')
      .lean();
    user = new User({
      name: previousOrder?.customerName?.trim() || cleanEmail.split('@')[0],
      email: cleanEmail,
      role: 'customer',
      isActive: true,
    });
  } else if (!user.name) {
    const previousOrder = await Order.findOne({ customerEmail: cleanEmail })
      .sort({ createdAt: -1 })
      .select('customerName')
      .lean();
    if (previousOrder?.customerName?.trim()) user.name = previousOrder.customerName.trim();
    else user.name = cleanEmail.split('@')[0];
  }

  try {
    await user.save();
  } catch (error) {
    if (error.code !== 11000) throw error;
    user = await User.findOne({ email: cleanEmail });
    if (!user || user.role !== 'customer' || !user.isActive) {
      throw new AppError('This email cannot be used for a customer account.', 409, 'CUSTOMER_IDENTITY_CONFLICT');
    }
  }

  return {
    user: sanitizeUser(user),
    token: signToken({
      sub: user._id.toString(),
      role: 'customer',
      type: 'customer',
    }),
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
  !['admin', 'kitchen', 'delivery', 'manager'].includes(user.role)
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

  if (!['admin', 'kitchen', 'delivery', 'manager'].includes(role)) {
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
  findOrCreateFirebaseCustomer,
  loginCustomerByEmail,
  staffLogin,
  registerStaffUser,
  getAuthenticatedUser,
  logoutUser,
  sanitizeUser,
};
