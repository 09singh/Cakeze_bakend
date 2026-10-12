const service = require("./addon.service");
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
module.exports = {
  getActive: wrap(async (req, res) => res.json({ success: true, data: await service.getActiveAddons(req.query) })),
  getAdmin: wrap(async (req, res) => res.json({ success: true, data: await service.getAdminAddons() })),
  create: wrap(async (req, res) => res.status(201).json({ success: true, message: "Add-on created successfully", data: await service.createAddon(req.body, req.file) })),
  remove: wrap(async (req, res) => { await service.removeAddon(req.params.id); res.json({ success: true, message: "Add-on removed successfully" }); }),
};
