const service = require('./customer.service');

const list = async (req, res, next) => {
  try { res.json({ success: true, data: await service.listCustomers() }); }
  catch (error) { next(error); }
};
const create = async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await service.saveCustomer(req.body) }); }
  catch (error) { next(error); }
};
const bulk = async (req, res, next) => {
  try { res.status(200).json({ success: true, data: await service.importCustomers(req.body.customers) }); }
  catch (error) { next(error); }
};
const orders = async (req, res, next) => {
  try { res.json({ success: true, data: await service.getCustomerOrders(req.params.phone) }); }
  catch (error) { next(error); }
};
module.exports = { list, create, bulk, orders };
