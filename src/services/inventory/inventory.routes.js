const express = require("express");
const Joi = require("joi");
const { authenticate, requireRole } = require("../auth/auth.middleware");
const controller = require("./inventory.controller");
const router = express.Router();
const admin = [authenticate, requireRole("admin")];
router.get("/", ...admin, controller.list);
router.patch("/:kind/:id", ...admin, (req, res, next) => {
  const { error, value } = Joi.object({ quantity: Joi.number().integer().min(0).max(10000000).required() }).validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ success: false, message: "Quantity must be a whole number from 0 to 10,000,000." });
  req.body = value;
  return next();
}, controller.set);
module.exports = router;
