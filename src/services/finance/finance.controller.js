const Joi = require("joi");
const service = require("./finance.service");

async function getFinance(req, res, next) {
  try {
    const schema = Joi.object({
      from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(""),
      to: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(""),
      type: Joi.string().valid("all", "website", "admin", "cash", "upi").default("all"),
      mode: Joi.string().valid("all", "cash", "cod", "upi", "other").default("all"),
    });
    const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true });
    const invalidDate = [value?.from, value?.to].some((date) => date && Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime()));
    const normalizedDate = !invalidDate && [value?.from, value?.to].some((date) => date && new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date);
    if (error || invalidDate || normalizedDate || (value.from && value.to && value.from > value.to)) {
      return res.status(400).json({ success: false, message: "Provide a valid date range and finance filters." });
    }
    const data = await service.getFinanceData(value);
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
}

async function getInvoice(req, res, next) {
  try {
    const invoice = await service.getFinanceInvoice(req.params.orderId);
    return res.status(200).json({ success: true, data: invoice });
  } catch (error) { return next(error); }
}

async function createAdjustment(req, res, next) {
  try {
    const schema = Joi.object({
      orderId: Joi.string().trim().min(1).required(),
      kind: Joi.string().valid("credit-note", "refund").required(),
      amount: Joi.number().positive().precision(2).required(),
      reason: Joi.string().trim().min(2).max(250).required(),
      method: Joi.string().valid("cash", "upi").default("cash"),
    });
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ success: false, message: error.details.map((detail) => detail.message).join(" ") });
    const record = await service.createFinanceAdjustment(value.orderId, value, req.user);
    return res.status(201).json({ success: true, data: record });
  } catch (error) { return next(error); }
}

module.exports = { getFinance, getInvoice, createAdjustment };