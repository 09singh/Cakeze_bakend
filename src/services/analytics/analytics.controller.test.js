const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const controller = require('./analytics.controller');
const service = require('./analytics.service');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'analytics-test-secret-that-is-not-used-for-authentication';
}
const { requireRole } = require('../auth/auth.middleware');
const analyticsRouter = require('./analytics.routes');

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
}

test('rejects invalid dates before calling the report service', async () => {
  let called = false;
  const original = service.getOverview;
  service.getOverview = async () => { called = true; };
  const response = makeResponse();
  try {
    await controller.getOverview(
      { query: { startDate: 'not-a-date', endDate: 'today' } },
      response,
      (error) => { throw error; }
    );
  } finally {
    service.getOverview = original;
  }

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.success, false);
  assert.equal(called, false);
});

test('returns report results without exposing provider internals', async () => {
  const original = service.getOverview;
  service.getOverview = async () => ({ summary: { sessions: 3 } });
  const response = makeResponse();
  try {
    await controller.getOverview(
      { query: { startDate: '7daysAgo', endDate: 'today' } },
      response,
      (error) => { throw error; }
    );
  } finally {
    service.getOverview = original;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(response.body, { success: true, data: { summary: { sessions: 3 } } });
});

test('admin authorization middleware rejects non-admin and unauthenticated users', () => {
  const middleware = requireRole('admin');
  let nextError;
  middleware({ user: { role: 'kitchen' }, authType: 'staff' }, {}, (error) => { nextError = error; });
  assert.equal(nextError.statusCode, 403);

  nextError = null;
  middleware({}, {}, (error) => { nextError = error; });
  assert.equal(nextError.statusCode, 401);

  nextError = null;
  middleware({ user: { role: 'admin' }, authType: 'staff' }, {}, (error) => { nextError = error; });
  assert.equal(nextError, undefined);
});

test('analytics endpoint rejects requests without a staff token', async () => {
  const app = express();
  app.use('/api/v1/admin/analytics', analyticsRouter);
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({ message: error.message });
  });

  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/admin/analytics/overview`
    );
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('reports a safe setup error when the numeric GA4 Property ID is missing', async () => {
  const previousPropertyId = process.env.GA4_PROPERTY_ID;
  delete process.env.GA4_PROPERTY_ID;
  const response = makeResponse();
  try {
    await controller.getOverview(
      { query: { startDate: '7daysAgo', endDate: 'today' } },
      response,
      (error) => { throw error; }
    );
  } finally {
    if (previousPropertyId === undefined) delete process.env.GA4_PROPERTY_ID;
    else process.env.GA4_PROPERTY_ID = previousPropertyId;
  }

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /numeric GA4 Property ID/);
});
