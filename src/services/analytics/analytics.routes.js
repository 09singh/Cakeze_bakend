const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('./analytics.controller');
const { authenticate, requireRole } = require('../auth/auth.middleware');

const router = express.Router();

const analyticsRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many analytics requests. Please wait and try again.',
  },
});

router.get(
  '/overview',
  analyticsRateLimit,
  authenticate,
  requireRole('admin'),
  controller.getOverview
);

module.exports = router;
