const service = require("./coupon.service");
const wrap = (fn) => async (req, res, next) => { try { res.json({ success: true, data: await fn(req) }); } catch (error) { next(error); } };
module.exports = {
  validate: wrap((req) => service.validateCoupon(req.body.code)),
  list: wrap(() => service.listCoupons()),
  create: wrap(async (req) => ({ ...(await service.createCoupon(req.body)).toObject() })),
  update: wrap((req) => service.updateCoupon(req.params.id, req.body.isActive)),
};
