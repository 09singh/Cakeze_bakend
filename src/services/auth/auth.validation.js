const { body, validationResult } = require('express-validator');

const phoneValidator = body('phone')
  .trim()
  .notEmpty()
  .withMessage('Phone number is required.')
  .matches(/^\+?[1-9]\d{8,14}$/)
  .withMessage('Phone number must be a valid international format.');

const otpValidator = body('otp')
  .trim()
  .notEmpty()
  .withMessage('OTP is required.')
  .matches(/^\d{4,6}$/)
  .withMessage('OTP must be a 4 to 6 digit number.');

const emailValidator = body('email')
  .trim()
  .notEmpty()
  .withMessage('Email is required.')
  .isEmail()
  .withMessage('Email must be valid.');

const passwordValidator = body('password')
  .notEmpty()
  .withMessage('Password is required.')
  .isLength({ min: 8 })
  .withMessage('Password must be at least 8 characters long.');

function validateRequest(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation failed.',
      errors: errors.array().map(({ location, msg, path }) => ({
        location,
        msg,
        path,
      })),
    });
  }

  return next();
}

module.exports = {
  customerPhoneValidation: [phoneValidator],
  customerOtpValidation: [phoneValidator, otpValidator],
  staffLoginValidation: [emailValidator, passwordValidator],
  validateRequest,
};
