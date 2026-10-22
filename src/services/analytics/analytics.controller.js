const AppError = require('../../utils/AppError');
const service = require('./analytics.service');

async function getOverview(req, res, next) {
  try {
    const { startDate, endDate } = service.validateDateRange(req.query);
    const result = await service.getOverview(startDate, endDate);

    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return next(error);
  }
}

module.exports = { getOverview };
