const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'customer-order-auth-test-secret-at-least-32-chars';
}
if (!process.env.OTP_HASH_SECRET) {
  process.env.OTP_HASH_SECRET = 'email-otp-auth-test-secret-at-least-32-chars';
}
process.env.NODE_ENV = 'production';

const app = require('../../app');
const { requireCustomer } = require('../auth/auth.middleware');

test('customer order endpoints reject requests without an authenticated session', async () => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    const requests = [
      ['GET', '/api/v1/orders/me'],
      ['POST', '/api/v1/orders/me'],
      ['POST', '/api/v1/orders'],
      ['POST', '/api/v1/orders/shared-form'],
      ['POST', '/api/v1/orders/CZ0123456789ABCDEF0123/cancellation-request'],
      ['POST', '/api/v1/orders/CZ0123456789ABCDEF0123/cancel'],
      ['PATCH', '/api/v1/orders/CZ0123456789ABCDEF0123/customer-details'],
    ];

    for (const [method, path] of requests) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
      assert.equal(response.status, 401, `${method} ${path} must require authentication`);
    }

    const oldLookup = await fetch(
      `http://127.0.0.1:${port}/api/v1/orders/lookup?phone=9876543210&orderId=CZ0123456789ABCDEF0123`
    );
    assert.equal(oldLookup.status, 404);

    const bypassAttempt = await fetch(`http://127.0.0.1:${port}/api/v1/orders/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkoutId: '00000000-0000-4000-8000-000000000001',
        customerEmail: 'customer@example.com',
        emailVerificationToken: 'invalid.signed.token.value',
        phone: '9876543210',
        productId: '507f1f77bcf86cd799439011',
        size: '1 kg',
        flavour: 'Chocolate',
        quantity: 1,
        delivery: {
          method: 'delivery',
          date: '2030-01-01',
          time: '5:00 PM - 6:00 PM',
          address: 'A complete delivery address for this test',
        },
        paymentMethod: 'cod',
      }),
    });
    assert.equal(bypassAttempt.status, 401, 'an unsigned verification token cannot create an order');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('customer-only routes reject staff identity', () => {
  let nextError;
  requireCustomer(
    { authType: 'staff', user: { role: 'admin' } },
    {},
    (error) => { nextError = error; }
  );

  assert.equal(nextError.statusCode, 403);
  assert.equal(nextError.code, 'CUSTOMER_REQUIRED');
});
