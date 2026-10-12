const mongoose = require("mongoose");

/*
|--------------------------------------------------------------------------
| Validate MongoDB ObjectId
|--------------------------------------------------------------------------
*/

const validateProductId = (req, res, next) => {
  const { id } = req.params;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid product ID",
    });
  }

  next();
};

/*
|--------------------------------------------------------------------------
| Validate Product Slug
|--------------------------------------------------------------------------
*/

const validateProductSlug = (req, res, next) => {
  const { slug } = req.params;

  if (!slug || typeof slug !== "string") {
    return res.status(400).json({
      success: false,
      message: "Invalid product slug",
    });
  }

  const slugRegex =
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  if (!slugRegex.test(slug)) {
    return res.status(400).json({
      success: false,
      message: "Invalid product slug",
    });
  }

  next();
};

/*
|--------------------------------------------------------------------------
| Validate Product ID + Prevent Empty Body
|--------------------------------------------------------------------------
*/

const validateUpdateRequest = (
  req,
  res,
  next
) => {
  if (
    !req.body ||
    typeof req.body !== "object" ||
    Array.isArray(req.body) ||
    Object.keys(req.body).length === 0
  ) {
    return res.status(400).json({
      success: false,
      message: "Update data is required",
    });
  }

  next();
};

/*
|--------------------------------------------------------------------------
| Prevent Client From Sending MongoDB Internal Fields
|--------------------------------------------------------------------------
|
| We don't want frontend/admin to directly modify:
| - _id
| - createdAt
| - updatedAt
|
*/

const protectSystemFields = (
  req,
  res,
  next
) => {
  const forbiddenFields = [
    "_id",
    "__v",
    "createdAt",
    "updatedAt",
  ];

  const attemptedFields =
    forbiddenFields.filter(
      (field) =>
        Object.prototype.hasOwnProperty.call(
          req.body,
          field
        )
    );

  if (attemptedFields.length > 0) {
    return res.status(400).json({
      success: false,
      message:
        "System fields cannot be modified",
    });
  }

  next();
};

/*
|--------------------------------------------------------------------------
| Normalize Product Query
|--------------------------------------------------------------------------
|
| This keeps query parameters predictable before
| they reach the validator/service.
|
*/

const normalizeProductQuery = (
  req,
  res,
  next
) => {
  const query = req.query;

  if (query.search) {
    query.search = query.search.trim();
  }

  if (query.sort) {
    query.sort = query.sort.trim();
  }

  if (query.categoryId) {
    query.categoryId =
      query.categoryId.trim();
  }

  /*
   * Convert query strings to numbers.
   *
   * Express query params arrive as strings:
   *
   * ?page=2&limit=20
   *
   * becomes:
   *
   * page = "2"
   * limit = "20"
   */

  if (query.page !== undefined) {
    query.page = Number(query.page);
  }

  if (query.limit !== undefined) {
    query.limit = Number(query.limit);
  }

  /*
   * Convert isActive string to boolean.
   */

  if (query.isActive === "true") {
    query.isActive = true;
  }

  if (query.isActive === "false") {
    query.isActive = false;
  }

  next();
};

module.exports = {
  validateProductId,
  validateProductSlug,
  validateUpdateRequest,
  protectSystemFields,
  normalizeProductQuery,
};