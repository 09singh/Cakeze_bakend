const Joi = require("joi");
const mongoose = require("mongoose");

const objectId = (value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.error("any.invalid");
  }
  return value;
};

const checkoutIdSchema = Joi.string()
  .guid({ version: ["uuidv4", "uuidv5"] })
  .required();

const phoneSchema = Joi.string()
  .trim()
  .pattern(/^[+\d][\d\s()-]{6,19}$/)
  .custom((value, helpers) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      return helpers.error("any.invalid");
    }
    return value;
  })
  .required();

const createOrderSchema = Joi.object({
  checkoutId: checkoutIdSchema,
  phone: phoneSchema,
  productId: Joi.string().custom(objectId).required(),
  size: Joi.string().trim().min(1).max(50).required(),
  flavour: Joi.string().trim().min(1).max(50).required(),
  quantity: Joi.number().integer().min(1).max(20).default(1),
  addonIds: Joi.array().items(Joi.string().custom(objectId)).max(20).unique().default([]),
  customisation: Joi.object({
    nameOnCake: Joi.string().trim().max(30).allow("").default(""),
    messageOnCake: Joi.string().trim().max(100).allow("").default(""),
    colourChange: Joi.string().trim().max(50).allow("").default(""),
    addPhoto: Joi.string().trim().max(100).allow("").default(""),
    otherRequest: Joi.string().trim().max(200).allow("").default(""),
    referenceImage: Joi.string().max(500000).allow("").default(""),
    referenceImages: Joi.array().items(Joi.string().max(500000)).max(4).default([]),
    theme: Joi.string().trim().max(100).allow("").default(""),
    designNotes: Joi.string().trim().max(500).allow("").default(""),
    tiers: Joi.number().integer().min(1).max(6).allow(null).default(null),
    hasAllergy: Joi.boolean().default(false),
    allergyNotes: Joi.string().trim().max(300).allow("").default(""),
    paymentPreference: Joi.string().valid("cash", "upi").default("cash"),
  }).custom((value, helpers) => {
    const imageCharacters = (value.referenceImage || "").length + value.referenceImages.reduce((total, image) => total + image.length, 0);
    if (imageCharacters > 850000) return helpers.error("custom.referenceImagesTooLarge");
    return value;
  }).default({}),
  delivery: Joi.object({
    method: Joi.string().valid("delivery", "pickup").required(),
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    time: Joi.string().trim().min(1).max(50).required(),
    address: Joi.when("method", {
      is: "delivery",
      then: Joi.string().trim().min(1).max(1000).required(),
      otherwise: Joi.string().trim().max(1000).allow("").default(""),
    }),
  }).required(),
  couponCode: Joi.string().trim().uppercase().max(30).allow("", null).default(null),
  paymentMethod: Joi.string().valid("cod", "upi", "card", "netbanking", "wallet").required(),
});

const createAdminOrderSchema = createOrderSchema.keys({
  customerName: Joi.string().trim().max(100).allow("").default(""),
  gstin: Joi.string().trim().uppercase().length(15).allow("").default(""),
  unitPrice: Joi.number().min(0.01).required(),
});

const lookupOrderSchema = Joi.object({
  phone: phoneSchema,
  orderId: Joi.string().trim().uppercase().pattern(/^CZ[A-F0-9]{20}$/).required(),
});

module.exports = { createOrderSchema, createAdminOrderSchema, lookupOrderSchema };
