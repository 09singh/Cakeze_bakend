const express = require("express");
const controller = require("./order.controller");
const {
  createAdminOrderSchema,
  createOrderSchema,
  createVerifiedEmailOrderSchema,
  sharedOrderSchema,
  verifiedSharedOrderSchema,
  orderDetailsSchema,
  customerOrderDetailsSchema,
} = require("./order.validator");
const {
  authenticate,
  requireRole,
  requireCustomer,
  requireCustomerSession,
} = require("../auth/auth.middleware");


const router = express.Router();
const staff = [authenticate, requireRole("admin", "kitchen", "delivery")];
const admin = [authenticate, requireRole("admin")];
const manager = [authenticate, requireRole("manager")];
const cancellationAccess = (req, res, next) => {
  if (req.user?.role === "customer") return requireCustomer(req, res, next);
  return requireRole("delivery", "admin")(req, res, next);
};

const validate = (schema, source) => (req, res, next) => {
  const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
  if (error) {
    const errors = error.details.map((detail) => {
      const field = detail.path.join(".") || source;
      const reason = detail.type === "custom.referenceImagesTooLarge"
        ? "exceeds the combined reference image size limit."
        : detail.type === "any.required"
          ? "is required."
          : detail.type === "string.pattern.base"
            ? "has an invalid format."
            : detail.type === "any.only"
              ? "has an unsupported value."
              : "is invalid.";
      return `${field} ${reason}`;
    });

    if (process.env.NODE_ENV !== "production") {
      console.warn("[orders] request validation failed", {
        method: req.method,
        path: req.originalUrl,
        errors: error.details.map(({ path, type }) => ({
          field: path.join(".") || source,
          type,
        })),
      });
    }

    return res.status(400).json({
      success: false,
      message: "Please check the submitted order details.",
      errors,
    });
  }
  req[source] = value;
  return next();
};

router.post("/admin", ...admin, validate(createAdminOrderSchema, "body"), controller.createAdminOrder);
router.post("/shared-form", authenticate, requireCustomerSession, validate(sharedOrderSchema, "body"), controller.createSharedOrder);
router.post("/email", validate(createVerifiedEmailOrderSchema, "body"), controller.createEmailVerifiedOrder);
router.post("/email/shared-form", validate(verifiedSharedOrderSchema, "body"), controller.createVerifiedSharedOrder);
router.post("/email/orders", authenticate, requireCustomerSession, controller.listCustomerOrders);
router.get("/me", authenticate, requireCustomerSession, controller.listCustomerOrders);
router.post("/me", authenticate, requireCustomerSession, validate(createOrderSchema, "body"), controller.createCustomerOrder);
router.post("/", authenticate, requireCustomerSession, validate(createOrderSchema, "body"), controller.createCustomerOrder);
router.get("/manager/pickups", ...manager, controller.listManagerPickups);
router.patch("/:orderId/pickup/complete", ...manager, controller.completeManagerPickup);
router.get("/", ...staff, controller.listOrders);
router.patch("/:orderId/status", ...staff, controller.updateStatus);
router.post("/:orderId/cancellation-request", authenticate, requireCustomer, controller.requestCancellation);
router.post("/:orderId/cancel", authenticate, cancellationAccess, controller.cancelOrder);
router.patch("/:orderId/customer-details", authenticate, requireCustomer, validate(customerOrderDetailsSchema, "body"), controller.updateCustomerDetails);
router.patch("/:orderId/admin-details", ...admin, validate(orderDetailsSchema, "body"), controller.updateAdminDetails);
router.patch("/:orderId/cancellation-decision", ...admin, controller.decideCancellation);
router.post("/:orderId/payment", ...admin, controller.recordPayment);
router.post("/:orderId/payment/collect", authenticate, requireRole("delivery", "admin"), controller.recordPayment);
router.post("/:orderId/delivery-attempt", ...staff, controller.recordDeliveryAttempt);
router.patch("/:orderId/assignment", ...admin, controller.assignDelivery);
router.patch("/:orderId/admin-override", ...admin, controller.adminOverride);

module.exports = router;
