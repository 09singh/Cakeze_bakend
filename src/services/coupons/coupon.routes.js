const express = require("express");
const Joi = require("joi");
const mongoose = require("mongoose");
const { authenticate, requireRole } = require("../auth/auth.middleware");
const controller = require("./coupon.controller");
const router = express.Router();
const admin = [authenticate, requireRole("admin")];

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true, convert: true });
  if (error) return res.status(400).json({ success: false, message: "Invalid coupon details.", errors: error.details.map((detail) => detail.message) });
  req.body = value;
  return next();
};

router.post("/validate", validate(Joi.object({ code: Joi.string().trim().uppercase().min(4).max(30).pattern(/^[A-Z0-9_-]+$/).required() })), controller.validate);
router.get("/admin", ...admin, controller.list);
router.post("/admin", ...admin, validate(Joi.object({
  code: Joi.string().trim().uppercase().min(4).max(30).pattern(/^[A-Z0-9_-]+$/).required(),
  discountValue: Joi.number().integer().min(1).max(100).required(),
  isActive: Joi.boolean().default(true),
  startsAt: Joi.date().iso().allow(null).default(null),
  expiresAt: Joi.date().iso().allow(null).default(null),
  usageLimit: Joi.number().integer().min(1).allow(null).default(null),
}).custom((value, helpers) => {
  if (value.startsAt && value.expiresAt && value.startsAt >= value.expiresAt) return helpers.error("date.range");
  return value;
})), controller.create);
router.patch("/admin/:id", admin[0], admin[1], (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid coupon ID." });
  const { error, value } = Joi.object({ isActive: Joi.boolean().required() }).validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ success: false, message: "isActive must be true or false." });
  req.body = value;
  return next();
}, controller.update);

module.exports = router;
