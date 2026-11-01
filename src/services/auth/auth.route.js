const express = require('express');
const authController = require('./auth.controller');
const authMiddleware = require('./auth.middleware');
const authValidation = require('./auth.validation');
const Joi = require('joi');
const authService = require('./auth.service');
const { registerStaffUser } = authService;
const User = require('./auth.model');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { emailOtpService } = require('./emailOtp.service');

const router = express.Router();
const emailOtpRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification requests. Please try again later.' },
});
const emailOtpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification attempts. Please try again later.' },
});

router.post('/email-otp/request', emailOtpRequestLimiter, async (req, res, next) => {
  try {
    const result = await emailOtpService.request(req.body || {});
    return res.status(200).json({
      success: true,
      message: 'If the request is valid, a verification code has been sent.',
      data: result,
    });
  } catch (error) { return next(error); }
});

router.post('/email-otp/verify', emailOtpVerifyLimiter, async (req, res, next) => {
  try {
    const result = await emailOtpService.verify(req.body || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
});

router.post('/email-otp/customer-session', emailOtpVerifyLimiter, async (req, res, next) => {
  try {
    const { email, checkoutId, verificationToken } = req.body || {};
    const verified = await emailOtpService.validateToken(
      verificationToken,
      email,
      checkoutId
    );
    const result = await authService.loginCustomerByEmail(verified.email);
    return res.status(200).json({ success: true, ...result });
  } catch (error) { return next(error); }
});

router.post('/admin/staff', authMiddleware.authenticate, authMiddleware.requireRole('admin'), async (req, res, next) => {
  const { error, value } = Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().trim().email().required(),
    password: Joi.string().min(8).max(128).required(),
    role: Joi.string().valid('manager', 'kitchen', 'delivery').required(),
  }).validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ success: false, message: 'Provide a name, valid email, role, and password of at least 8 characters.' });
  try {
    return res.status(201).json({ success: true, user: await registerStaffUser(value) });
  } catch (staffError) { return next(staffError); }
});

router.get('/admin/staff', authMiddleware.authenticate, authMiddleware.requireRole('admin'), async (_req, res, next) => {
  try {
    const users = await User.find({ role: { $in: ['manager', 'kitchen', 'delivery'] } })
      .select('name email role isActive createdAt')
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ success: true, users });
  } catch (error) { return next(error); }
});

router.delete('/admin/staff/:id', authMiddleware.authenticate, authMiddleware.requireRole('admin'), async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid staff account ID.' });
  }
  try {
    const user = await User.findOneAndDelete({
      _id: req.params.id,
      role: { $in: ['manager', 'kitchen', 'delivery'] },
    }).select('_id name email role');
    if (!user) {
      return res.status(404).json({ success: false, message: 'Staff account not found.' });
    }
    return res.status(200).json({ success: true, user });
  } catch (error) { return next(error); }
});

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
