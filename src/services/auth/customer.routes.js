const express = require('express');
const { authenticate, requireRole } = require('./auth.middleware');
const controller = require('./customer.controller');

const router = express.Router();
const admin = [authenticate, requireRole('admin')];
router.get('/admin/customers', ...admin, controller.list);
router.post('/admin/customers', ...admin, controller.create);
router.post('/admin/customers/bulk', ...admin, controller.bulk);
router.get('/admin/customers/:phone/orders', ...admin, controller.orders);
module.exports = router;
