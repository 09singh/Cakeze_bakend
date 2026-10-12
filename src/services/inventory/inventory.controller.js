const service = require("./inventory.service");
const wrap = (fn) => async (req, res, next) => { try { res.json({ success: true, data: await fn(req) }); } catch (error) { next(error); } };
module.exports = {
  list: wrap(() => service.listInventory()),
  set: wrap((req) => service.setInventory(req.params.kind, req.params.id, req.body.quantity)),
};
