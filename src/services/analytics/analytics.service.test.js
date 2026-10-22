const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CACHE_TTL_MS,
  createAnalyticsService,
  validateDateRange,
} = require('./analytics.service');

function makeClient() {
  let batchCalls = 0;
  let ecommerceCalls = 0;

  return {
    get calls() {
      return { batchCalls, ecommerceCalls };
    },
    async batchRunReports() {
      batchCalls += 1;
      return [[
        {
          metricHeaders: [
            { name: 'activeUsers' },
            { name: 'totalUsers' },
            { name: 'sessions' },
            { name: 'screenPageViews' },
            { name: 'engagementRate' },
          ],
          rows: [{ metricValues: ['10', '12', '15', '20', '0.5'].map((value) => ({ value })) }],
        },
        {
          dimensionHeaders: [{ name: 'date' }],
          metricHeaders: [
            { name: 'activeUsers' },
            { name: 'sessions' },
            { name: 'screenPageViews' },
          ],
          rows: [{
            dimensionValues: [{ value: '20261020' }],
            metricValues: ['10', '15', '20'].map((value) => ({ value })),
          }],
        },
        {
          dimensionHeaders: [{ name: 'sessionSourceMedium' }],
          metricHeaders: [{ name: 'sessions' }, { name: 'activeUsers' }],
          rows: [{
            dimensionValues: [{ value: 'google / organic' }],
            metricValues: [{ value: '8' }, { value: '7' }],
          }],
        },
        {
          dimensionHeaders: [{ name: 'pagePath' }],
          metricHeaders: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
          rows: [{
            dimensionValues: [{ value: '/' }],
            metricValues: [{ value: '20' }, { value: '10' }],
          }],
        },
        {
          dimensionHeaders: [{ name: 'deviceCategory' }],
          metricHeaders: [{ name: 'sessions' }, { name: 'activeUsers' }],
          rows: [{
            dimensionValues: [{ value: 'mobile' }],
            metricValues: [{ value: '12' }, { value: '9' }],
          }],
        },
      ]];
    },
    async runReport() {
      ecommerceCalls += 1;
      return [{
        dimensionHeaders: [{ name: 'eventName' }],
        metricHeaders: [{ name: 'eventCount' }, { name: 'totalRevenue' }],
        rows: [{
          dimensionValues: [{ value: 'purchase' }],
          metricValues: [{ value: '2' }, { value: '1250.5' }],
        }],
      }];
    },
  };
}

test('validates date presets, calendar dates, and the maximum reporting range', () => {
  const today = new Date('2026-10-22T12:00:00.000Z');

  assert.deepEqual(validateDateRange({}, today), {
    startDate: '7daysAgo',
    endDate: 'today',
  });
  assert.deepEqual(
    validateDateRange({ startDate: '2026-10-01', endDate: '2026-10-22' }, today),
    { startDate: '2026-10-01', endDate: '2026-10-22' }
  );
  assert.throws(
    () => validateDateRange({ startDate: '2026-02-30', endDate: 'today' }, today),
    { code: 'ANALYTICS_INVALID_DATE' }
  );
  assert.throws(
    () => validateDateRange({ startDate: '2026-10-10', endDate: '2026-10-01' }, today),
    { code: 'ANALYTICS_INVALID_DATE' }
  );
  assert.throws(
    () => validateDateRange({ startDate: '2026-07-01', endDate: '2026-10-01' }, today),
    { code: 'ANALYTICS_INVALID_DATE' }
  );
  assert.throws(
    () => validateDateRange({ startDate: '2026-10-01', endDate: 'today', arbitrary: 'value' }, today),
    { code: 'ANALYTICS_INVALID_DATE' }
  );
});

test('maps real report results and caches matching date ranges for ten minutes', async () => {
  const client = makeClient();
  const cache = new Map();
  const service = createAnalyticsService({
    loadClient: () => client,
    loadPropertyId: () => '123456789',
    cache,
    now: () => Date.parse('2026-10-22T12:00:00.000Z'),
  });

  const report = await service.getOverview('7daysAgo', 'today');
  assert.deepEqual(report.summary, {
    activeUsers: 10,
    totalUsers: 12,
    sessions: 15,
    pageViews: 20,
    engagementRate: 0.5,
  });
  assert.equal(report.dailyTraffic[0].sessions, 15);
  assert.equal(report.sources[0].sourceMedium, 'google / organic');
  assert.equal(report.pages[0].pagePath, '/');
  assert.equal(report.devices[0].category, 'mobile');
  assert.deepEqual(report.ecommerce.events[0], {
    eventName: 'purchase',
    eventCount: 2,
    revenue: 1250.5,
  });

  await service.getOverview('7daysAgo', 'today');
  assert.deepEqual(client.calls, { batchCalls: 1, ecommerceCalls: 1 });
});

test('refreshes cached reports after the ten-minute TTL and maps empty reports to empty arrays', async () => {
  let currentTime = Date.parse('2026-10-22T12:00:00.000Z');
  let calls = 0;
  const emptyReport = {
    metricHeaders: [{ name: 'activeUsers' }],
    rows: [],
  };
  const client = {
    async batchRunReports() {
      calls += 1;
      return [[emptyReport, emptyReport, emptyReport, emptyReport, emptyReport]];
    },
    async runReport() {
      return [{ dimensionHeaders: [{ name: 'eventName' }], rows: [] }];
    },
  };
  const service = createAnalyticsService({
    loadClient: () => client,
    loadPropertyId: () => '123456789',
    cache: new Map(),
    now: () => currentTime,
  });

  const empty = await service.getOverview('7daysAgo', 'today');
  assert.deepEqual(empty.summary, {
    activeUsers: 0,
    totalUsers: 0,
    sessions: 0,
    pageViews: 0,
    engagementRate: 0,
  });
  assert.deepEqual(empty.dailyTraffic, []);
  assert.deepEqual(empty.ecommerce.events, []);

  currentTime += CACHE_TTL_MS;
  await service.getOverview('7daysAgo', 'today');
  assert.equal(calls, 2);
});

test('retries a transient report error once and returns a safe quota error', async () => {
  let attempts = 0;
  let pauses = 0;
  const service = createAnalyticsService({
    loadClient: () => ({
      async batchRunReports() {
        attempts += 1;
        const error = new Error('sensitive upstream detail');
        error.code = 8;
        throw error;
      },
    }),
    loadPropertyId: () => '123456789',
    cache: new Map(),
    pause: async () => { pauses += 1; },
  });

  await assert.rejects(
    service.getOverview('7daysAgo', 'today'),
    (error) => error.code === 'ANALYTICS_QUOTA' && !error.message.includes('sensitive')
  );
  assert.equal(attempts, 2);
  assert.equal(pauses, 1);
});
