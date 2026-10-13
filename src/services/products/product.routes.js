const express = require("express");

const router = express.Router();

const productController = require("./product.controller");

const {
  validateProductId,
  validateProductSlug,
  validateUpdateRequest,
  protectSystemFields,
  normalizeProductQuery,
} = require("./product.middleware");

const {
  createProductSchema,
  createReadyNowProductSchema,
  readyNowQuerySchema,
  updateProductSchema,
  productIdSchema,
  getProductsQuerySchema,
} = require("./product.validator");

const {
  authenticate,
  requireRole,
} = require("../auth/auth.middleware");

const Category = require("../products/category/category.model");
const upload = require("../../middleware/upload.middleware");

const parseProductMultipart = (req, res, next) => {
  if (!req.body.product) return next();
  try {
    req.body = JSON.parse(req.body.product);
    next();
  } catch (error) {
    res.status(400).json({ success: false, message: "Invalid product form data." });
  }
};
/*
|--------------------------------------------------------------------------
| Joi Validation Helpers
|--------------------------------------------------------------------------
*/

const validateBody = (schema) => {
  return (req, res, next) => {
    const { error, value } =
      schema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (detail) => detail.message
        ),
      });
    }

    req.body = value;

    next();
  };
};

const validateQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } =
      schema.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
      });

    if (error) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid query parameters",
        errors: error.details.map(
          (detail) => detail.message
        ),
      });
    }

    req.query = value;

    next();
  };
};

const validateParams = (schema) => {
  return (req, res, next) => {
    const { error, value } =
      schema.validate(req.params, {
        abortEarly: false,
        stripUnknown: true,
      });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid parameters",
        errors: error.details.map(
          (detail) => detail.message
        ),
      });
    }

    req.params = value;

    next();
  };
};

/*
|--------------------------------------------------------------------------
| CUSTOMER ROUTES
|--------------------------------------------------------------------------
*/

router.get(
  "/ready-now",
  validateQuery(readyNowQuerySchema),
  productController.getReadyNowProducts
);

router.get(
  "/",
  normalizeProductQuery,
  validateQuery(getProductsQuerySchema),
  productController.getCustomerProducts
);

router.get(
  "/slug/:slug",
  validateProductSlug,
  productController.getCustomerProductBySlug
);

/*
|--------------------------------------------------------------------------
| ADMIN ROUTES
|--------------------------------------------------------------------------
*/

router.get(
  "/admin/ready-now",
  authenticate,
  requireRole("admin"),
  productController.getAdminReadyNowProducts
);

router.post(
  "/admin/ready-now",
  authenticate,
  requireRole("admin"),
  upload.array("images", 5),
  parseProductMultipart,
  validateBody(createReadyNowProductSchema),
  productController.createReadyNowProduct
);

router.get(
  "/admin",
  authenticate,
  requireRole("admin"),
  normalizeProductQuery,
  validateQuery(getProductsQuerySchema),
  productController.getAdminProducts
);

router.post(
  "/admin",
  authenticate,
  requireRole("admin"),
  upload.array("images", 10),
  parseProductMultipart,
  protectSystemFields,
  validateBody(createProductSchema),
  productController.createProduct
);

router.patch(
  "/admin/:id",
  authenticate,
  requireRole("admin"),
  validateProductId,
  validateParams(productIdSchema),
  validateUpdateRequest,
  protectSystemFields,
  validateBody(updateProductSchema),
  productController.updateProduct
);

router.delete("/admin/:id", authenticate, requireRole("admin"), validateProductId, validateParams(productIdSchema), productController.removeProduct);

router.patch(
  "/admin/:id/deactivate",
  authenticate,
  requireRole("admin"),
  validateProductId,
  validateParams(productIdSchema),
  productController.deactivateProduct
);

router.patch(
  "/admin/:id/activate",
  authenticate,
  requireRole("admin"),
  validateProductId,
  validateParams(productIdSchema),
  productController.activateProduct
);

/*
|--------------------------------------------------------------------------
| CUSTOMER - PRODUCT BY ID
|--------------------------------------------------------------------------
|
| Keep this AFTER /admin routes.
|
*/

router.get(
  "/:id",
  validateProductId,
  validateParams(productIdSchema),
  productController.getCustomerProductById
);

module.exports = router;
