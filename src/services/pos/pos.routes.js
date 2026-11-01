const express = require('express');
const Joi = require('joi');
const mongoose = require('mongoose');
const { authenticate, requireRole } = require('../auth/auth.middleware');
const service = require('./pos.service');
const { createReadyNowProductSchema } = require('../products/product.validator');
const upload = require('../../middleware/upload.middleware');
const router = express.Router();
router.use(authenticate, requireRole('manager'));

const handler = (fn, status = 200) => async (req, res, next) => { try { res.status(status).json({ success: true, data: await fn(req) }); } catch (error) { next(error); } };
const parseProductMultipart = (req, res, next) => {
  if (!req.body.product) return next();
  try {
    req.body = JSON.parse(req.body.product);
    next();
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid product form data.' });
  }
};
router.get('/products', handler(() => service.listProducts()));
router.post('/products', upload.array('images', 5), parseProductMultipart, (req, res, next) => {
  if (!req.files?.length) {
    return res.status(400).json({ success: false, message: 'Add a product image before saving.' });
  }
  const { error, value } = createReadyNowProductSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ success: false, message: 'Check the Ready Now product details.', errors: error.details.map((item) => item.message) });
  req.body = value; return next();
}, handler((req) => service.createProduct(req.body, req.files), 201));
router.patch('/products/:id', (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid product ID.' });
  const { error, value } = Joi.object({ inventoryQuantity: Joi.number().integer().min(0).max(1000000), isActive: Joi.boolean() }).min(1).validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ success: false, message: 'Provide a stock quantity or availability setting.' });
  req.body = value; return next();
}, handler((req) => service.updateProduct(req.params.id, req.body)));
router.post('/sales', (req, res, next) => {
  const { error, value } = Joi.object({
    customerName: Joi.string().trim().min(2).max(100).required(),
    phone: Joi.string().trim().pattern(/^[+\d][\d\s()-]{6,19}$/).required(),
    items: Joi.array().min(1).max(50).items(Joi.object({ productId: Joi.string().hex().length(24).required(), quantity: Joi.number().integer().min(1).max(100).required() })).required(),
    paymentMethod: Joi.string().valid('cash', 'upi', 'card').required(),
  }).validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ success: false, message: 'Enter the customer, products, quantities, and payment method.' });
  const digits = value.phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return res.status(400).json({ success: false, message: 'Enter a valid customer phone number.' });
  req.body = value; return next();
}, handler((req) => service.createSale(req.body, req.user), 201));
router.get('/sales', handler(() => service.listSales()));
module.exports = router;
