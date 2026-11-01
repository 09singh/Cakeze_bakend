const { createHmac, randomBytes, randomInt, timingSafeEqual } = require('crypto');
const jwt = require('jsonwebtoken');
const AppError = require('../../utils/AppError');
const EmailOtpChallenge = require('./emailOtp.model');

const OTP_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_SECONDS = 20 * 60;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

function assertEmail(email) {
  const normalized = normalizeEmail(email);
  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new AppError('Enter a valid email address.', 400, 'INVALID_EMAIL');
  }
  return normalized;
}

function getOtpHashSecret() {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppError('Email verification is not configured.', 503, 'EMAIL_OTP_NOT_CONFIGURED');
  }
  return secret;
}

function createCodeHash(email, challengeId, code, secret = getOtpHashSecret()) {
  return createHmac('sha256', secret)
    .update(`${email}:${challengeId}:${code}`)
    .digest('hex');
}

function compareCodeHash(actualHash, expectedHash) {
  if (typeof actualHash !== 'string' || typeof expectedHash !== 'string') return false;
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createMongoStore(model = EmailOtpChallenge) {
  return {
    findByEmail: (email) => model.findOne({ email }).lean(),
    replace: (challenge, now) => model.findOneAndUpdate(
      {
        email: challenge.email,
        $or: [
          { resendAvailableAt: { $lte: now } },
          { resendAvailableAt: { $exists: false } },
        ],
      },
      { $set: challenge },
      { upsert: true, new: true, runValidators: true }
    ).lean(),
    invalidate: (email, challengeId) => model.updateOne(
      { email, challengeId },
      { $set: { codeHash: null, expiresAt: new Date() } }
    ),
    incrementAttempts: (email, challengeId, now) => model.findOneAndUpdate(
      { email, challengeId, verifiedAt: null, expiresAt: { $gt: now }, attempts: { $lt: MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { new: true }
    ).lean(),
    verify: (email, challengeId, now, expiresAt, tokenJti) => model.findOneAndUpdate(
      { email, challengeId, verifiedAt: null, consumedCheckoutId: null, expiresAt: { $gt: now }, attempts: { $lt: MAX_ATTEMPTS } },
      { $set: { codeHash: null, verifiedAt: now, tokenJti, expiresAt } },
      { new: true }
    ).lean(),
    reserve: (email, challengeId, tokenJti, checkoutId, now) => model.findOneAndUpdate(
      {
        email,
        challengeId,
        tokenJti,
        verifiedAt: { $ne: null },
        expiresAt: { $gt: now },
        $or: [{ consumedCheckoutId: null }, { consumedCheckoutId: checkoutId }],
      },
      { $set: { consumedCheckoutId: checkoutId } },
      { new: true }
    ).lean(),
  };
}

async function sendVerificationEmail(email, code, {
  apiKey = process.env.SENDLIBERTY_API_KEY,
  emailFrom = process.env.EMAIL_FROM,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey || !emailFrom || typeof fetchImpl !== 'function') {
    throw new AppError('Email verification is not configured.', 503, 'EMAIL_OTP_NOT_CONFIGURED');
  }

  const text = `Your Cakezee verification code is ${code}. It expires in 5 minutes. If you did not request this code, you can ignore this email.`;
  const html = `<p>Your Cakezee verification code is <strong>${code}</strong>.</p><p>It expires in 5 minutes. If you did not request this code, you can ignore this email.</p>`;
  let response;
  try {
    response = await fetchImpl('https://sendliberty.com/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        from: emailFrom,
        to: email,
        subject: 'Your Cakezee verification code',
        text,
        html,
      }),
    });
  } catch {
    throw new AppError('Could not send the verification email. Please try again later.', 503, 'EMAIL_PROVIDER_UNAVAILABLE');
  }

  if (!response.ok) {
    console.error('[email-otp] Sendliberty rejected the email request', { status: response.status });
    throw new AppError('Could not send the verification email. Please try again later.', 503, 'EMAIL_PROVIDER_REJECTED');
  }
}

function createEmailOtpService({
  store = createMongoStore(),
  sendEmail = sendVerificationEmail,
  now = () => new Date(),
  generateCode = () => String(randomInt(100000, 1000000)),
  hashSecret = process.env.OTP_HASH_SECRET,
  tokenSecret = process.env.JWT_SECRET,
} = {}) {
  const requireSecrets = () => {
    if (!hashSecret || hashSecret.length < 32 || !tokenSecret || tokenSecret.length < 32) {
      throw new AppError('Email verification is not configured.', 503, 'EMAIL_OTP_NOT_CONFIGURED');
    }
  };

  const request = async ({ email: inputEmail, checkoutId }) => {
    const email = assertEmail(inputEmail);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(checkoutId || ''))) {
      throw new AppError('Invalid checkout. Refresh the page and try again.', 400, 'INVALID_CHECKOUT');
    }
    requireSecrets();
    const currentTime = now();
    const previous = await store.findByEmail(email);
    if (previous?.resendAvailableAt && new Date(previous.resendAvailableAt) > currentTime) {
      const retryAfterSeconds = Math.ceil((new Date(previous.resendAvailableAt) - currentTime) / 1000);
      throw new AppError(`Please wait ${retryAfterSeconds} seconds before requesting another code.`, 429, 'OTP_RESEND_COOLDOWN');
    }

    const challengeId = randomBytes(24).toString('hex');
    const code = generateCode();
    const expiresAt = new Date(currentTime.getTime() + OTP_TTL_MS);
    const resendAvailableAt = new Date(currentTime.getTime() + RESEND_COOLDOWN_MS);
    const challenge = {
      email,
      challengeId,
      checkoutId,
      codeHash: createCodeHash(email, challengeId, code, hashSecret),
      attempts: 0,
      resendAvailableAt,
      verifiedAt: null,
      tokenJti: null,
      consumedCheckoutId: null,
      expiresAt,
      deleteAt: new Date(currentTime.getTime() + 24 * 60 * 60 * 1000),
    };

    try {
      await store.replace(challenge, currentTime);
    } catch (error) {
      if (error.code === 11000) {
        const latest = await store.findByEmail(email);
        const retryAfterSeconds = latest?.resendAvailableAt
          ? Math.max(1, Math.ceil((new Date(latest.resendAvailableAt) - currentTime) / 1000))
          : 60;
        throw new AppError(`Please wait ${retryAfterSeconds} seconds before requesting another code.`, 429, 'OTP_RESEND_COOLDOWN');
      }
      throw error;
    }
    try {
      await sendEmail(email, code);
    } catch (error) {
      await store.invalidate(email, challengeId);
      if (error instanceof AppError) throw error;
      throw new AppError('Could not send the verification email. Please try again later.', 503, 'EMAIL_PROVIDER_UNAVAILABLE');
    }
    return { email, resendAfterSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000) };
  };

  const verify = async ({ email: inputEmail, checkoutId, code }) => {
    const email = assertEmail(inputEmail);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(checkoutId || ''))) {
      throw new AppError('Invalid checkout. Refresh the page and try again.', 400, 'INVALID_CHECKOUT');
    }
    if (!/^\d{6}$/.test(String(code || ''))) {
      throw new AppError('Enter the 6-digit code sent to your email.', 400, 'OTP_INVALID');
    }
    requireSecrets();

    const currentTime = now();
    const challenge = await store.findByEmail(email);
    if (!challenge || challenge.checkoutId !== checkoutId || !challenge.codeHash || challenge.verifiedAt) {
      throw new AppError('This verification code is invalid or has already been used.', 400, 'OTP_INVALID');
    }
    if (new Date(challenge.expiresAt) <= currentTime) {
      await store.invalidate(email, challenge.challengeId);
      throw new AppError('This verification code has expired. Request a new code.', 410, 'OTP_EXPIRED');
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
      throw new AppError('Too many incorrect codes. Request a new code.', 429, 'OTP_TOO_MANY_ATTEMPTS');
    }

    const submittedHash = createCodeHash(email, challenge.challengeId, code, hashSecret);
    if (!compareCodeHash(submittedHash, challenge.codeHash)) {
      const updated = await store.incrementAttempts(email, challenge.challengeId, currentTime);
      if (!updated || updated.attempts >= MAX_ATTEMPTS) {
        throw new AppError('Too many incorrect codes. Request a new code.', 429, 'OTP_TOO_MANY_ATTEMPTS');
      }
      throw new AppError('The verification code is incorrect. Please try again.', 400, 'OTP_INVALID');
    }

    const tokenJti = randomBytes(24).toString('hex');
    const tokenExpiresAt = new Date(currentTime.getTime() + TOKEN_TTL_SECONDS * 1000);
    const verifiedChallenge = await store.verify(
      email,
      challenge.challengeId,
      currentTime,
      tokenExpiresAt,
      tokenJti
    );
    if (!verifiedChallenge) {
      throw new AppError('This verification code is invalid or has already been used.', 400, 'OTP_INVALID');
    }

    const verificationToken = jwt.sign({
      type: 'email-verification',
      purpose: 'order-email-verification',
      email,
      checkoutId,
      challengeId: challenge.challengeId,
      jti: tokenJti,
    }, tokenSecret, {
      expiresIn: TOKEN_TTL_SECONDS,
      issuer: 'cakezee',
      audience: 'order-email-verification',
    });
    return { email, verificationToken, expiresInSeconds: TOKEN_TTL_SECONDS };
  };

  const validateToken = async (token, expectedEmail, expectedCheckoutId) => {
    requireSecrets();
    let claims;
    try {
      claims = jwt.verify(token, tokenSecret, {
        issuer: 'cakezee',
        audience: 'order-email-verification',
        algorithms: ['HS256'],
      });
    } catch {
      throw new AppError('Email verification has expired. Verify your email again.', 401, 'EMAIL_VERIFICATION_INVALID');
    }

    const email = assertEmail(expectedEmail);
    if (
      claims.type !== 'email-verification' ||
      claims.purpose !== 'order-email-verification' ||
      claims.email !== email ||
      (expectedCheckoutId && claims.checkoutId !== expectedCheckoutId)
    ) {
      throw new AppError('Verify the email address used for this checkout.', 403, 'EMAIL_VERIFICATION_MISMATCH');
    }
    const challenge = await store.reserve(
      email,
      claims.challengeId,
      claims.jti,
      claims.checkoutId,
      now()
    );
    if (!challenge) {
      throw new AppError('Email verification has expired or is no longer valid. Verify your email again.', 401, 'EMAIL_VERIFICATION_INVALID');
    }
    return { email, checkoutId: claims.checkoutId, challengeId: claims.challengeId };
  };

  return { request, verify, validateToken };
}

const emailOtpService = createEmailOtpService();

module.exports = {
  emailOtpService,
  createEmailOtpService,
  createMongoStore,
  normalizeEmail,
  assertEmail,
  createCodeHash,
  compareCodeHash,
  sendVerificationEmail,
};
