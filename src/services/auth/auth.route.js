const express = require('express');
const authController = require('./auth.controller');
const authMiddleware = require('./auth.middleware');
const authValidation = require('./auth.validation');

const router = express.Router();

router.post(
  '/customer/request-otp',
  authMiddleware.customerOtpRequestLimiter,
  authValidation.customerPhoneValidation,
  authValidation.validateRequest,
  authController.requestCustomerOtp
);

router.post(
  '/customer/verify-otp',
  authMiddleware.customerOtpVerifyLimiter,
  authValidation.customerOtpValidation,
  authValidation.validateRequest,
  authController.verifyCustomerOtp
);

router.post(
  '/staff/login',
  authMiddleware.staffLoginLimiter,
  authValidation.staffLoginValidation,
  authValidation.validateRequest,
  authController.staffLogin
);


router.get(
  '/me',
  (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  },
  authMiddleware.authenticate,
  authController.getCurrentUser
);

// router.get('/me', authMiddleware.authenticate, authController.getCurrentUser);
router.post('/logout', authMiddleware.authenticate, authController.logout);

module.exports = router;
