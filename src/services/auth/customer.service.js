const User = require('./auth.model');
const Order = require('../orders/order.model');
const AppError = require('../../utils/AppError');
const mongoose = require('mongoose');

const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
const toCustomer = (user, stats = {}) => ({
  id: user?._id?.toString() || `phone-${stats.phone}`,
  name: user?.name || stats.name || '',
  phone: user?.phone || stats.phone || '',
  email: user?.email || '',
  createdAt: user?.createdAt || stats.firstOrderAt || null,
  orderCount: stats.orderCount || 0,
  totalSpent: stats.totalSpent || 0,
  lastOrderAt: stats.lastOrderAt || null,
});

async function listCustomers() {
  const [users, orderStats] = await Promise.all([
    User.find({ role: 'customer' }).select('name phone email createdAt').lean(),
    Order.aggregate([
      { $match: { customer: { $ne: null } } },
      { $group: {
        _id: '$customer',
        orderCount: { $sum: 1 },
        totalSpent: { $sum: '$pricing.total' },
        lastOrderAt: { $max: '$createdAt' },
        firstOrderAt: { $min: '$createdAt' },
        name: { $last: '$customerName' },
      } },
    ]),
  ]);
  const statsByCustomer = new Map(orderStats.map((stats) => [String(stats._id), stats]));
  const customersById = new Map();
  users.forEach((user) => {
    const id = String(user._id);
    customersById.set(id, toCustomer(user, statsByCustomer.get(id)));
  });
  return Array.from(customersById.values()).sort((a, b) => (b.lastOrderAt || b.createdAt || 0) - (a.lastOrderAt || a.createdAt || 0));
}

async function saveCustomer(input) {
  const name = String(input.name || '').trim();
  const phone = normalizePhone(input.phone);
  const email = String(input.email || '').trim().toLowerCase();
  if (!name || phone.length < 10 || phone.length > 15) {
    throw new AppError('A customer name and valid phone number are required.', 400, 'INVALID_CUSTOMER');
  }
  let user = await User.findOne({ phone });
  if (!user) user = new User({ phone, role: 'customer' });
  user.name = name;
  user.role = 'customer';
  if (email) user.email = email;
  await user.save();
  return user.toSafeObject();
}

async function importCustomers(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) {
    throw new AppError('Provide between 1 and 500 customers per import.', 400, 'INVALID_CUSTOMER_IMPORT');
  }
  const result = { created: 0, updated: 0, skipped: 0, errors: [] };
  for (let index = 0; index < rows.length; index += 1) {
    try {
      const phone = normalizePhone(rows[index]?.phone);
      const existing = phone ? await User.findOne({ phone }).select('_id') : null;
      await saveCustomer(rows[index]);
      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.skipped += 1;
      result.errors.push({ row: index + 2, message: error.code === 11000 ? 'Phone or email already belongs to another account.' : error.message });
    }
  }
  return result;
}

async function getCustomerOrders(customerId) {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw new AppError('Invalid customer reference.', 400, 'INVALID_CUSTOMER_ID');
  }
  const customer = await User.findOne({ _id: customerId, role: 'customer' }).select('_id');
  if (!customer) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  return Order.find({ customer: customer._id }).sort({ createdAt: -1 }).limit(500).lean();
}

module.exports = { listCustomers, saveCustomer, importCustomers, getCustomerOrders };
