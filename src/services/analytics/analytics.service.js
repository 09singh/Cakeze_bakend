const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const AppError = require('../../utils/AppError');

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const REPORT_TIMEOUT_MS = 12 * 1000;
const reportCache = new Map();
let analyticsClient;

const ecommerceEventNames = [
  'add_to_cart',
  'add_payment_info',
  'add_shipping_info',
  'begin_checkout',
  'purchase',
  'refund',
  'remove_from_cart',
  'select_item',
  'view_item',
  'view_item_list',
];

function parseDate(value, field) {
  if (['today', 'yesterday', '7daysAgo', '30daysAgo'].includes(value)) {
    return value;
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(
      `${field} must be today, yesterday, 7daysAgo, 30daysAgo, or a YYYY-MM-DD date.`,
      400,
      'ANALYTICS_INVALID_DATE'
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(`${field} is not a valid calendar date.`, 400, 'ANALYTICS_INVALID_DATE');
  }

  return value;
}

function dateToUtc(value, today = new Date()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  const currentDate = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  ));
  if (value === 'today') return currentDate;
  if (value === 'yesterday') currentDate.setUTCDate(currentDate.getUTCDate() - 1);
  if (value === '7daysAgo') currentDate.setUTCDate(currentDate.getUTCDate() - 7);
  if (value === '30daysAgo') currentDate.setUTCDate(currentDate.getUTCDate() - 30);
  return currentDate;
}

function validateDateRange(query = {}, today = new Date()) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new AppError('Provide a valid analytics date range.', 400, 'ANALYTICS_INVALID_DATE');
  }

  const allowedKeys = ['startDate', 'endDate'];
  if (Object.keys(query).some((key) => !allowedKeys.includes(key))) {
    throw new AppError('Only startDate and endDate are supported.', 400, 'ANALYTICS_INVALID_DATE');
  }

  const startDate = parseDate(query.startDate || '7daysAgo', 'startDate');
  const endDate = parseDate(query.endDate || 'today', 'endDate');
  const start = dateToUtc(startDate, today);
  const end = dateToUtc(endDate, today);
  const todayUtc = dateToUtc('today', today);
  const spanDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;

  if (start > end || end > todayUtc || spanDays > 90) {
    throw new AppError(
      'Choose a date range ending today or earlier and spanning no more than 90 days.',
      400,
      'ANALYTICS_INVALID_DATE'
    );
  }

  return { startDate, endDate };
}

function getPropertyId() {
  const propertyId = process.env.GA4_PROPERTY_ID?.trim();
  if (!propertyId || !/^\d+$/.test(propertyId)) {
    throw new AppError(
      'GA4 reporting is not configured. Set GA4_PROPERTY_ID to the numeric GA4 Property ID.',
      503,
      'ANALYTICS_NOT_CONFIGURED'
    );
  }
  return propertyId;
}

function getAnalyticsClient() {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) {
    throw new AppError(
      'GA4 reporting is not configured. Add the GOOGLE_SERVICE_ACCOUNT_JSON secret to the backend environment.',
      503,
      'ANALYTICS_NOT_CONFIGURED'
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(rawCredentials);
  } catch {
    throw new AppError(
      'GOOGLE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.',
      503,
      'ANALYTICS_INVALID_CREDENTIALS'
    );
  }

  if (
    credentials?.type !== 'service_account' ||
    typeof credentials.client_email !== 'string' ||
    typeof credentials.private_key !== 'string' ||
    !credentials.private_key.includes('PRIVATE KEY')
  ) {
    throw new AppError(
      'GOOGLE_SERVICE_ACCOUNT_JSON must contain a valid service-account email and private key.',
      503,
      'ANALYTICS_INVALID_CREDENTIALS'
    );
  }

  if (!analyticsClient) {
    try {
      analyticsClient = new BetaAnalyticsDataClient({
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key,
        },
      });
    } catch {
      throw new AppError(
        'The Google service-account credentials could not be initialized. Verify the backend secret.',
        503,
        'ANALYTICS_INVALID_CREDENTIALS'
      );
    }
  }

  return analyticsClient;
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getMetric(row, name, metricHeaders) {
  const index = metricHeaders.findIndex((header) => header.name === name);
  return index < 0 ? 0 : asNumber(row.metricValues?.[index]?.value);
}

function getDimension(row, name, dimensionHeaders) {
  const index = dimensionHeaders.findIndex((header) => header.name === name);
  return index < 0 ? '' : row.dimensionValues?.[index]?.value || '';
}

function mapRows(report, mapRow) {
  const rows = report?.rows || [];
  const dimensionHeaders = report?.dimensionHeaders || [];
  const metricHeaders = report?.metricHeaders || [];
  return rows.map((row) => mapRow(row, dimensionHeaders, metricHeaders));
}

function isRetryable(error) {
  const code = Number(error?.code);
  return [429, 500, 502, 503, 504, 8].includes(code) ||
    ['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED'].includes(error?.code);
}

async function callWithRetry(operation, pause) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === 1 || !isRetryable(error)) {
        if ([429, 8].includes(Number(error?.code)) || error?.code === 'RESOURCE_EXHAUSTED') {
          throw new AppError(
            'Google Analytics is temporarily over quota. Wait a few minutes and refresh.',
            503,
            'ANALYTICS_QUOTA'
          );
        }
        throw new AppError(
          'Google Analytics could not return a report. Check the property ID, service-account Viewer access, and Data API availability.',
          502,
          'ANALYTICS_UPSTREAM_ERROR'
        );
      }
      await pause(250);
    }
  }
  throw new AppError('Google Analytics could not return a report.', 502, 'ANALYTICS_UPSTREAM_ERROR');
}

function createAnalyticsService({
  loadClient = getAnalyticsClient,
  loadPropertyId = getPropertyId,
  cache = reportCache,
  now = Date.now,
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  async function getOverview(startDate, endDate) {
    const propertyId = loadPropertyId();
    const key = `${propertyId}:${startDate}:${endDate}`;
    const currentTime = now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > currentTime) return cached.data;

    for (const [cacheKey, entry] of cache.entries()) {
      if (entry.expiresAt <= currentTime) cache.delete(cacheKey);
    }

    const client = loadClient();
    const property = `properties/${propertyId}`;
    const dateRanges = [{ startDate, endDate }];
    const base = { dateRanges };
    const requests = [
      {
        ...base,
        metrics: [
          { name: 'activeUsers' },
          { name: 'totalUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'engagementRate' },
        ],
      },
      {
        ...base,
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      },
      {
        ...base,
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      },
      {
        ...base,
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      },
      {
        ...base,
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      },
    ];

    let reports;
    try {
      const response = await callWithRetry(
        () => client.batchRunReports(
          { property, requests },
          { timeout: REPORT_TIMEOUT_MS }
        ),
        pause
      );
      [reports] = response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Google Analytics could not return a report. Check the property ID, service-account Viewer access, and Data API availability.',
        502,
        'ANALYTICS_UPSTREAM_ERROR'
      );
    }

    let ecommerceReport;
    try {
      const response = await callWithRetry(
        () => client.runReport(
          {
            property,
            dateRanges,
            dimensions: [{ name: 'eventName' }],
            metrics: [{ name: 'eventCount' }, { name: 'totalRevenue' }],
            dimensionFilter: {
              filter: {
                fieldName: 'eventName',
                inListFilter: { values: ecommerceEventNames },
              },
            },
            limit: 10,
          },
          { timeout: REPORT_TIMEOUT_MS }
        ),
        pause
      );
      [ecommerceReport] = response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Google Analytics could not return ecommerce event data. Verify that ecommerce events are available in this property.',
        502,
        'ANALYTICS_ECOMMERCE_UNAVAILABLE'
      );
    }

    const summary = reports?.[0];
    const summaryRow = summary?.rows?.[0];
    const result = {
      summary: {
        activeUsers: summaryRow ? getMetric(summaryRow, 'activeUsers', summary.metricHeaders || []) : 0,
        totalUsers: summaryRow ? getMetric(summaryRow, 'totalUsers', summary.metricHeaders || []) : 0,
        sessions: summaryRow ? getMetric(summaryRow, 'sessions', summary.metricHeaders || []) : 0,
        pageViews: summaryRow ? getMetric(summaryRow, 'screenPageViews', summary.metricHeaders || []) : 0,
        engagementRate: summaryRow ? getMetric(summaryRow, 'engagementRate', summary.metricHeaders || []) : 0,
      },
      dailyTraffic: mapRows(reports?.[1], (row, dimensions, metrics) => ({
        date: getDimension(row, 'date', dimensions),
        activeUsers: getMetric(row, 'activeUsers', metrics),
        sessions: getMetric(row, 'sessions', metrics),
        pageViews: getMetric(row, 'screenPageViews', metrics),
      })),
      sources: mapRows(reports?.[2], (row, dimensions, metrics) => ({
        sourceMedium: getDimension(row, 'sessionSourceMedium', dimensions) || '(not set)',
        sessions: getMetric(row, 'sessions', metrics),
        activeUsers: getMetric(row, 'activeUsers', metrics),
      })),
      pages: mapRows(reports?.[3], (row, dimensions, metrics) => ({
        pagePath: getDimension(row, 'pagePath', dimensions) || '(not set)',
        pageViews: getMetric(row, 'screenPageViews', metrics),
        activeUsers: getMetric(row, 'activeUsers', metrics),
      })),
      devices: mapRows(reports?.[4], (row, dimensions, metrics) => ({
        category: getDimension(row, 'deviceCategory', dimensions) || '(not set)',
        sessions: getMetric(row, 'sessions', metrics),
        activeUsers: getMetric(row, 'activeUsers', metrics),
      })),
      ecommerce: {
        events: mapRows(ecommerceReport, (row, dimensions, metrics) => ({
          eventName: getDimension(row, 'eventName', dimensions),
          eventCount: getMetric(row, 'eventCount', metrics),
          revenue: getMetric(row, 'totalRevenue', metrics),
        })),
      },
      lastUpdated: new Date(currentTime).toISOString(),
    };

    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
    cache.set(key, { data: result, expiresAt: currentTime + CACHE_TTL_MS });
    return result;
  }

  return { getOverview };
}

const defaultService = createAnalyticsService();

module.exports = {
  CACHE_TTL_MS,
  createAnalyticsService,
  getOverview: (...args) => defaultService.getOverview(...args),
  validateDateRange,
};
