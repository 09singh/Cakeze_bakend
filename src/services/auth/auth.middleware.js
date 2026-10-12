const rateLimit = require('express-rate-limit');
const AppError = require('../../utils/AppError');
const { verifyToken } = require('../../utils/jwt');
const User = require('./auth.model');

const customerOtpRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many OTP requests. Please wait a minute and try again.',
  },
  statusCode: 429,
});

const customerOtpVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many OTP verification attempts. Please wait and try again.',
  },
  statusCode: 429,
});

const staffLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many login attempts. Please wait and try again.',
  },
  statusCode: 429,
});

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      throw new AppError('Authentication token is required.', 401, 'TOKEN_REQUIRED');
    }

    const payload = verifyToken(token);
    const staffRoles = ['admin', 'kitchen', 'delivery'];
    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      !['customer', 'admin', 'kitchen', 'delivery'].includes(payload.role) ||
      !['customer', 'staff'].includes(payload.type) ||
      (payload.type === 'staff' && !staffRoles.includes(payload.role)) ||
      (payload.type === 'customer' && payload.role !== 'customer')
    ) {
      throw new AppError('Authentication failed.', 401, 'AUTH_INVALID');
    }

    const user = await User.findById(payload.sub);

    if (!user || !user.isActive || payload.role !== user.role) {
      throw new AppError('Authentication failed.', 401, 'AUTH_INVALID');
    }

    req.user = user;
    req.authType = payload.type;
    req.authToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401, 'AUTH_REQUIRED'));
    }

    if (
      req.authType === 'staff' &&
      roles.length > 0 &&
      roles.includes(req.user.role)
    ) {
      return next();
    }

    return next(new AppError('You do not have permission to access this resource.', 403, 'FORBIDDEN'));
  };
}

module.exports = {
  customerOtpRequestLimiter,
  customerOtpVerifyLimiter,
  staffLoginLimiter,
  authenticate,
  requireRole,
};
