const { validationResult } = require('express-validator');
const authService = require('./auth.service');

async function requestCustomerOtp(req, res, next) {
  try {
    const result = await authService.requestCustomerOtp(req.body.phone);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function verifyCustomerOtp(req, res, next) {
  try {
    const result = await authService.verifyCustomerOtp(req.body.phone, req.body.otp);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function staffLogin(req, res, next) {
  try {
    const result = await authService.staffLogin(req.body.email, req.body.password);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function getCurrentUser(req, res, next) {
  try {
    const result = await authService.getAuthenticatedUser(req.user._id);
    res.status(200).json({ user: result });
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    const result = authService.logoutUser(req.authToken);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requestCustomerOtp,
  verifyCustomerOtp,
  staffLogin,
  getCurrentUser,
  logout,
};
