
const express = require("express");

const router = express.Router();

const categoryController = require("./category.controller");

const {
  createCategorySchema,
} = require("./category.validator");

const {
  authenticate,
  requireRole,
} = require("../../auth/auth.middleware");

const upload = require("../../../middleware/upload.middleware");

/*
|--------------------------------------------------------------------------
| VALIDATE BODY
|--------------------------------------------------------------------------
*/

const validateBody = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(
      req.body,
      {
        abortEarly: false,
        stripUnknown: true,
      }
    );

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

/*
|--------------------------------------------------------------------------
| CUSTOMER ROUTES
|--------------------------------------------------------------------------
*/

// Return active categories only
router.get(
  "/",
  categoryController.getActiveCategories
);

/*
|--------------------------------------------------------------------------
| ADMIN ROUTES
|--------------------------------------------------------------------------
*/

// Return all categories, active and inactive
router.get(
  "/admin",
  authenticate,
  requireRole("admin"),
  categoryController.getAllCategories
);

// Create category with optional image upload
router.post(
  "/admin",
  authenticate,
  requireRole("admin"),
  upload.single("image"),
  validateBody(createCategorySchema),
  categoryController.createCategory
);

// Deactivate category
router.patch(
  "/admin/:id/deactivate",
  authenticate,
  requireRole("admin"),
  categoryController.deactivateCategory
);

router.delete("/admin/:id", authenticate, requireRole("admin"), categoryController.removeCategory);

// Reactivate category
router.patch(
  "/admin/:id/activate",
  authenticate,
  requireRole("admin"),
  categoryController.activateCategory
);

module.exports = router;