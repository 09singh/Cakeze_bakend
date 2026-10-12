const Joi = require("joi");
const mongoose = require("mongoose");

/*
|--------------------------------------------------------------------------
| ObjectId Validator
|--------------------------------------------------------------------------
*/

const objectId = (value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.error("any.invalid");
  }
  return value;
};
 
/*
|--------------------------------------------------------------------------
| Image
|--------------------------------------------------------------------------
*/

const imageSchema = Joi.object({
  url: Joi.string().uri().required(),

  publicId: Joi.string()
    .trim()
    .allow(null, "")
    .default(null),

  width: Joi.number()
    .integer()
    .positive()
    .allow(null)
    .default(null),

  height: Joi.number()
    .integer()
    .positive()
    .allow(null)
    .default(null),

  alt: Joi.string()
    .trim()
    .max(150)
    .allow("")
    .default(""),
});

/*
|--------------------------------------------------------------------------
| Weight / Size
|--------------------------------------------------------------------------
*/

const sizeSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(1)
    .max(50)
    .required(),

  value: Joi.number()
    .positive()
    .required(),

  unit: Joi.string()
    .trim()
    .lowercase()
    .max(20)
    .default("kg"),
});

/*
|--------------------------------------------------------------------------
| Flavour Pricing
|--------------------------------------------------------------------------
|
| basePrice = price for baseWeight.
|
*/

const flavourSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(1)
    .max(50)
    .required(),

  basePrice: Joi.number()
    .min(0)
    .required(),
});

/*
|--------------------------------------------------------------------------
| Pricing
|--------------------------------------------------------------------------
*/

const pricingSchema = Joi.object({
  baseWeight: Joi.number()
    .positive()
    .default(0.5),

  weightUnit: Joi.string()
    .trim()
    .lowercase()
    .max(20)
    .default("kg"),

  currency: Joi.string()
    .trim()
    .uppercase()
    .valid("INR")
    .default("INR"),
});

/*
|--------------------------------------------------------------------------
| CREATE PRODUCT
|--------------------------------------------------------------------------
*/

const createProductSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(150)
    .required(),

  slug: Joi.string()
    .trim()
    .lowercase()
    .min(2)
    .max(180)
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .required(),

  description: Joi.string()
    .trim()
    .max(2000)
    .allow("")
    .default(""),

  categoryId: Joi.string()
    .custom(objectId)
    .required(),

  images: Joi.array()
    .items(imageSchema)
    .max(10)
    .default([]),

  sizes: Joi.array()
    .items(sizeSchema)
    .max(20)
    .min(1)
    .required(),

  flavours: Joi.array()
    .items(flavourSchema)
    .max(30)
    .min(1)
    .required(),

  pricing: pricingSchema.required(),

  badge: Joi.string()
    .trim()
    .max(50)
    .allow(null, "")
    .default(null),

  isActive: Joi.boolean()
    .default(true),

  sortOrder: Joi.number()
    .integer()
    .min(0)
    .default(0),
});

/*
|--------------------------------------------------------------------------
| UPDATE PRODUCT
|--------------------------------------------------------------------------
*/

const updateProductSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(150),

  slug: Joi.string()
    .trim()
    .lowercase()
    .min(2)
    .max(180)
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),

  description: Joi.string()
    .trim()
    .max(2000)
    .allow(""),

  categoryId: Joi.string()
    .custom(objectId),

  images: Joi.array()
    .items(imageSchema)
    .max(10),

  sizes: Joi.array()
    .items(sizeSchema)
    .max(20)
    .min(1),

  flavours: Joi.array()
    .items(flavourSchema)
    .max(30)
    .min(1),

  pricing: pricingSchema,

  badge: Joi.string()
    .trim()
    .max(50)
    .allow(null, ""),

  isActive: Joi.boolean(),

  sortOrder: Joi.number()
    .integer()
    .min(0),
}).min(1);

/*
|--------------------------------------------------------------------------
| Product ID
|--------------------------------------------------------------------------
*/

const productIdSchema = Joi.object({
  id: Joi.string()
    .custom(objectId)
    .required(),
});

/*
|--------------------------------------------------------------------------
| Product Query
|--------------------------------------------------------------------------
*/

const getProductsQuerySchema = Joi.object({
  page: Joi.number()
    .integer()
    .min(1)
    .default(1),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(50)
    .default(20),

  categoryId: Joi.string()
    .custom(objectId)
    .optional(),

  search: Joi.string()
    .trim()
    .max(100)
    .optional(),

  isActive: Joi.boolean()
    .optional(),

  sort: Joi.string()
    .valid(
      "newest",
      "oldest",
      "sort_order"
    )
    .default("sort_order"),
});

module.exports = {
  createProductSchema,
  updateProductSchema,
  productIdSchema,
  getProductsQuerySchema,
};