const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');

const authRouter = require('../src/services/auth/auth.route');
const customerRouter = require('./services/auth/customer.routes');
const productRouter = require('../src/services/products/product.routes');
const categoryRouter = require('../src/services/products/category/category.routes');
const addonRouter = require('../src/services/addons/addon.routes');
const orderRouter = require('./services/orders/order.routes');
const inventoryRouter = require('./services/inventory/inventory.routes');
const couponRouter = require('./services/coupons/coupon.routes');
const financeRouter = require('./services/finance/finance.routes');

// const { globalRateLimiter } = require('./middleware/rateLimit.middleware');

const app = express();

/*
|--------------------------------------------------------------------------
| Security
|--------------------------------------------------------------------------
*/

app.use(helmet());

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

app.use(
  cors({
    origin:
      process.env.FRONTEND_URL ||
      'https://cakezee.netlify.app',

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
    ],
  })
);

/*
|--------------------------------------------------------------------------
| Logging
|--------------------------------------------------------------------------
*/

app.use(morgan('dev'));

/*
|--------------------------------------------------------------------------
| Body Parser
|--------------------------------------------------------------------------
*/

app.use(
  express.json({
    limit: '1mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '1mb',
  })
);

/*
|--------------------------------------------------------------------------
| Global Rate Limiting
|--------------------------------------------------------------------------
*/

// app.use('/api', globalRateLimiter);

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'cakezee-backend',
  });
});

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/auth', customerRouter);

app.use(
  '/api/v1/products',
  productRouter
);

app.use(
  '/api/v1/categories',
  categoryRouter
);

app.use('/api/v1/addons', addonRouter);
app.use('/api/v1/orders', orderRouter);
app.use('/api/v1/inventory', inventoryRouter);
app.use('/api/v1/coupons', couponRouter);
app.use('/api/v1/finance', financeRouter);

/*
|--------------------------------------------------------------------------
| 404 Handler
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found.',
  });
});

/*
|--------------------------------------------------------------------------
| Global Error Handler
|--------------------------------------------------------------------------
*/

app.use((error, req, res, next) => {
  const statusCode =
    error.statusCode || 500;

  const message =
    error.message ||
    'Something went wrong.';

  if (process.env.NODE_ENV !== 'production') {
    console.error(error);
  }

  res.status(statusCode).json({
    message,

    ...(process.env.NODE_ENV !== 'production' && {
      stack: error.stack,
    }),
  });
});

module.exports = app;

