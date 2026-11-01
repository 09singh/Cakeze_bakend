const { body, validationResult } = require('express-validator');

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
  staffLoginValidation: [emailValidator, passwordValidator],
  validateRequest,
};
