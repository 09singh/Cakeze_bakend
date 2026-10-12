const express = require("express");
const controller = require("./finance.controller");
const { authenticate, requireRole } = require("../auth/auth.middleware");
const router = express.Router();
const admin = [authenticate, requireRole("admin")];
router.get("/", ...admin, controller.getFinance);
router.get("/invoices/:orderId", ...admin, controller.getInvoice);
router.post("/refunds", ...admin, controller.createAdjustment);
module.exports = router;