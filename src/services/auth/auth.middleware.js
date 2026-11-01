const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const AppError = require('../../utils/AppError');
const { verifyToken } = require('../../utils/jwt');
const User = require('./auth.model');
const authService = require('./auth.service');
const firebaseAdmin = require('./firebase.admin');
const { emailOtpService } = require('./emailOtp.service');

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

    const unverifiedClaims = jwt.decode(token);
    if (unverifiedClaims?.type === 'email-verification') {
      const verified = await emailOtpService.validateToken(
        token,
        unverifiedClaims.email,
        unverifiedClaims.checkoutId
      );
      req.user = { _id: null, role: 'customer', email: verified.email, phone: '' };
      req.authType = 'email-verification';
      req.authToken = token;
      return next();
    }

    if (unverifiedClaims?.iss?.startsWith('https://securetoken.google.com/')) {
      const claims = await firebaseAdmin.verifyIdToken(token);
      const user = await authService.findOrCreateFirebaseCustomer(claims);
      req.user = await User.findById(user.id);
      req.authType = 'customer';
      req.authToken = token;
      return next();
    }

    const payload = verifyToken(token);
    const staffRoles = ['admin', 'kitchen', 'delivery', 'manager'];
    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      !staffRoles.includes(payload.role) ||
      payload.type !== 'staff'
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

function requireCustomer(req, res, next) {
  if (!['customer', 'email-verification'].includes(req.authType) || req.user?.role !== 'customer') {
    return next(new AppError('Customer authentication is required.', 403, 'CUSTOMER_REQUIRED'));
  }
  return next();
}

module.exports = {
  staffLoginLimiter,
  authenticate,
  requireRole,
  requireCustomer,
};
