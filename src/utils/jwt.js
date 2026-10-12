const jwt = require('jsonwebtoken');
const AppError = require('./AppError');

const JWT_SECRET = process.env.JWT_SECRET;
const revokedTokens = new Set();

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters.');
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  if (!token) {
    throw new AppError('Authentication token is missing.', 401, 'TOKEN_MISSING');
  }

  if (revokedTokens.has(token)) {
    throw new AppError('Session has expired. Please login again.', 401, 'TOKEN_REVOKED');
  }

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new AppError('Invalid or expired authentication token.', 401, 'TOKEN_INVALID');
  }
}

function revokeToken(token) {
  if (token) {
    revokedTokens.add(token);
  }
}

module.exports = {
  signToken,
  verifyToken,
  revokeToken,
};
