const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {
  createEmailOtpService,
  sendVerificationEmail,
} = require('./emailOtp.service');

const checkoutId = '00000000-0000-4000-8000-000000000001';
const hashSecret = 'h'.repeat(48);
const tokenSecret = 't'.repeat(48);

function createHarness(options = {}) {
  let currentTime = new Date();
  let nextCode = 123456;
  const records = new Map();
  const store = {
    findByEmail: async (email) => records.get(email) || null,
    replace: async (challenge, now) => {
      const current = records.get(challenge.email);
      if (current && new Date(current.resendAvailableAt) > now) {
        const duplicate = new Error('cooldown');
        duplicate.code = 11000;
        throw duplicate;
      }
      records.set(challenge.email, { ...challenge });
      return challenge;
    },
    invalidate: async (email, id) => {
      const record = records.get(email);
      if (record?.challengeId === id) {
        records.set(email, { ...record, codeHash: null, expiresAt: currentTime });
      }
    },
    incrementAttempts: async (email, id, now) => {
      const record = records.get(email);
      if (!record || record.challengeId !== id || new Date(record.expiresAt) <= now || record.verifiedAt) return null;
      const updated = { ...record, attempts: record.attempts + 1 };
      records.set(email, updated);
      return updated;
    },
    verify: async (email, id, now, expiresAt, tokenJti) => {
      const record = records.get(email);
      if (!record || record.challengeId !== id || record.verifiedAt || record.consumedCheckoutId || new Date(record.expiresAt) <= now || record.attempts >= 5) return null;
      const updated = { ...record, codeHash: null, verifiedAt: now, expiresAt, tokenJti };
      records.set(email, updated);
      return updated;
    },
    reserve: async (email, id, tokenJti, targetCheckoutId, now) => {
      const record = records.get(email);
      if (!record || record.challengeId !== id || record.tokenJti !== tokenJti || new Date(record.expiresAt) <= now) return null;
      if (record.consumedCheckoutId && record.consumedCheckoutId !== targetCheckoutId) return null;
      const updated = { ...record, consumedCheckoutId: targetCheckoutId };
      records.set(email, updated);
      return updated;
    },
  };
  const service = createEmailOtpService({
    store,
    sendEmail: options.sendEmail || (async (_email, code) => { options.sentCodes?.push(code); }),
    now: () => currentTime,
    generateCode: () => String(nextCode++).padStart(6, '0'),
    hashSecret,
    tokenSecret,
  });
  return {
    service,
    records,
    advance: (milliseconds) => { currentTime = new Date(currentTime.getTime() + milliseconds); },
  };
}

async function requestDefault(service, overrides = {}) {
  return service.request({
    email: 'Customer@Example.com',
    checkoutId,
    ...overrides,
  });
}

test('rejects invalid emails without attempting delivery', async () => {
  let sent = false;
  const { service } = createHarness({ sendEmail: async () => { sent = true; } });
  await assert.rejects(
    service.request({ email: 'not-an-email', checkoutId }),
    (error) => error.code === 'INVALID_EMAIL'
  );
  assert.equal(sent, false);
});

test('sends and verifies a single-use OTP and issues an email-bound checkout token', async () => {
  const sentCodes = [];
  const { service } = createHarness({ sentCodes });
  const requested = await requestDefault(service);
  assert.equal(requested.email, 'customer@example.com');
  assert.equal(requested.resendAfterSeconds, 60);
  assert.deepEqual(sentCodes, ['123456']);

  const verified = await service.verify({
    email: ' CUSTOMER@example.com ',
    checkoutId,
    code: '123456',
  });
  assert.equal(verified.email, 'customer@example.com');
  assert.equal(verified.expiresInSeconds, 1200);
  const claims = jwt.decode(verified.verificationToken);
  assert.deepEqual(
    await service.validateToken(verified.verificationToken, 'customer@example.com', checkoutId),
    { email: 'customer@example.com', checkoutId, challengeId: claims.challengeId }
  );
  await assert.rejects(
    service.verify({ email: 'customer@example.com', checkoutId, code: '123456' }),
    (error) => error.code === 'OTP_INVALID'
  );
  await assert.rejects(
    service.validateToken(verified.verificationToken, 'other@example.com', checkoutId),
    (error) => error.code === 'EMAIL_VERIFICATION_MISMATCH'
  );
  await assert.rejects(
    service.validateToken(verified.verificationToken, 'customer@example.com', '00000000-0000-4000-8000-000000000002'),
    (error) => error.code === 'EMAIL_VERIFICATION_MISMATCH'
  );
});

test('expires OTP challenges after five minutes', async () => {
  const { service, advance } = createHarness();
  await requestDefault(service);
  advance(5 * 60 * 1000 + 1);
  await assert.rejects(
    service.verify({ email: 'customer@example.com', checkoutId, code: '123456' }),
    (error) => error.code === 'OTP_EXPIRED'
  );
});

test('limits incorrect codes to five attempts', async () => {
  const { service } = createHarness();
  await requestDefault(service);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      service.verify({ email: 'customer@example.com', checkoutId, code: '999999' }),
      (error) => error.code === 'OTP_INVALID'
    );
  }
  await assert.rejects(
    service.verify({ email: 'customer@example.com', checkoutId, code: '999999' }),
    (error) => error.code === 'OTP_TOO_MANY_ATTEMPTS'
  );
});

test('enforces resend cooldown and invalidates the previous code on resend', async () => {
  const sentCodes = [];
  const { service, advance } = createHarness({ sentCodes });
  await requestDefault(service);
  await assert.rejects(
    requestDefault(service),
    (error) => error.code === 'OTP_RESEND_COOLDOWN'
  );
  advance(60 * 1000);
  await requestDefault(service);
  assert.deepEqual(sentCodes, ['123456', '123457']);
  await assert.rejects(
    service.verify({ email: 'customer@example.com', checkoutId, code: '123456' }),
    (error) => error.code === 'OTP_INVALID'
  );
  assert.equal(
    (await service.verify({ email: 'customer@example.com', checkoutId, code: '123457' })).email,
    'customer@example.com'
  );
});

test('provider failures are safe and invalidate the challenge', async () => {
  const { service } = createHarness({
    sendEmail: async () => { throw new Error('provider response with private details'); },
  });
  await assert.rejects(
    requestDefault(service),
    (error) => error.statusCode === 503 && !error.message.includes('private details')
  );
  await assert.rejects(
    service.verify({ email: 'customer@example.com', checkoutId, code: '123456' }),
    (error) => error.code === 'OTP_INVALID'
  );
});

test('rejects expired signed verification tokens', async () => {
  const { service } = createHarness();
  await requestDefault(service);
  const result = await service.verify({ email: 'customer@example.com', checkoutId, code: '123456' });
  const claims = jwt.decode(result.verificationToken);
  const expiredToken = jwt.sign({
    type: claims.type,
    purpose: claims.purpose,
    email: claims.email,
    checkoutId: claims.checkoutId,
    challengeId: claims.challengeId,
    jti: claims.jti,
    iat: Math.floor(Date.now() / 1000) - 3600,
  }, tokenSecret, {
    expiresIn: 1200,
    issuer: 'cakezee',
    audience: 'order-email-verification',
  });
  await assert.rejects(
    service.validateToken(expiredToken, 'customer@example.com', checkoutId),
    (error) => error.code === 'EMAIL_VERIFICATION_INVALID'
  );
});

test('uses the documented Sendliberty API key header and treats provider errors as failures', async () => {
  let captured;
  await sendVerificationEmail('customer@example.com', '123456', {
    apiKey: 'server-secret',
    emailFrom: 'Cakezee <cakezee@example.com>',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: false, status: 500 };
    },
  }).then(
    () => assert.fail('provider rejection must fail the request'),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.message.includes('500'), false);
    }
  );
  assert.equal(captured.url, 'https://sendliberty.com/api/send');
  assert.equal(captured.options.headers['x-api-key'], 'server-secret');
  assert.equal(JSON.parse(captured.options.body).to, 'customer@example.com');
  assert.equal(JSON.stringify(captured).includes('123456'), true);
});
