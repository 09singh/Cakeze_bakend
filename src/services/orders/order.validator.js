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
  customerName: Joi.string().trim().max(100).allow("").default(""),
  occasion: Joi.string().trim().max(100).allow("").default(""),
  occasionDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow("").default(""),
  productId: Joi.string().custom(objectId).required(),
  size: Joi.string().trim().min(1).max(50).required(),
  flavour: Joi.string().trim().min(1).max(50).required(),
  quantity: Joi.number().integer().min(1).max(20).default(1),
  addonIds: Joi.array().items(Joi.string().custom(objectId)).max(20).unique().default([]),
  customisation: Joi.object({
    nameOnCake: Joi.string().trim().max(30).allow("").default(""),
    eggless: Joi.boolean().default(false),
    messageOnCake: Joi.string().trim().max(100).allow("").default(""),
    colourChange: Joi.string().trim().max(50).allow("").default(""),
    addPhoto: Joi.string().trim().max(100).allow("").default(""),
    otherRequest: Joi.string().trim().max(200).allow("").default(""),
    referenceImage: Joi.string().max(500000).allow("").default(""),
    referenceImages: Joi.array().items(Joi.string().max(500000)).max(5).default([]),
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
    mapLink: Joi.string().uri({ scheme: ["http", "https"] }).max(2000).allow("").default(""),
    mapLinkText: Joi.string().trim().max(200).allow("").default(""),
  }).required(),
  couponCode: Joi.string().trim().uppercase().max(30).allow("", null).default(null),
  paymentMethod: Joi.string().valid("cod", "upi", "card", "netbanking", "wallet").required(),
});

const createAdminOrderSchema = createOrderSchema.keys({
  customerName: Joi.string().trim().max(100).allow("").default(""),
  occasion: Joi.string().trim().max(100).allow("").default(""),
  occasionDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow("").default(""),
  gstin: Joi.string().trim().uppercase().length(15).allow("").default(""),
  unitPrice: Joi.number().min(0.01).required(),
  deliveryFee: Joi.number().min(0).max(100000).default(60),
});

const sharedOrderItemSchema = Joi.object({
  itemType: Joi.string()
    .valid("Cake", "Cupcake", "Brownie", "Cookie", "Tarts", "Dessert jar", "Gift box", "Others")
    .required(),
  productId: Joi.string().custom(objectId).required(),
  size: Joi.when("itemType", {
    is: "Cake",
    then: Joi.string().trim().min(1).max(50).required(),
    otherwise: Joi.string().trim().max(50).allow("").default("piece"),
  }),
  flavour: Joi.string().trim().min(1).max(50).required(),
  quantity: Joi.number().integer().min(1).max(20).required(),
  customisation: Joi.object({
    eggless: Joi.boolean().default(false),
    theme: Joi.string().trim().max(100).allow("").default(""),
    messageOnCake: Joi.string().trim().max(100).allow("").default(""),
    designNotes: Joi.string().trim().max(500).allow("").default(""),
    otherRequest: Joi.string().trim().max(900).allow("").default(""),
    hasAllergy: Joi.boolean().default(false),
    allergyNotes: Joi.string().trim().max(300).allow("").default(""),
    referenceImages: Joi.array().items(Joi.string().max(500000)).max(5).default([]),
  }).default({}),
}).required();

const sharedOrderSchema = Joi.object({
  checkoutId: checkoutIdSchema,
  phone: phoneSchema,
  customerName: Joi.string().trim().min(2).max(100).required(),
  occasion: Joi.string().trim().min(1).max(100).required(),
  occasionDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow("").default(""),
  additionalNotes: Joi.string().trim().max(900).allow("").default(""),
  items: Joi.array().items(sharedOrderItemSchema).min(1).max(10).required(),
  delivery: Joi.object({
    method: Joi.string().valid("delivery", "pickup").required(),
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    time: Joi.string().trim().min(1).max(50).required(),
    address: Joi.when("method", {
      is: "delivery",
      then: Joi.string().trim().min(1).max(1000).required(),
      otherwise: Joi.string().trim().max(1000).allow("").default(""),
    }),
    mapLink: Joi.string().uri({ scheme: ["http", "https"] }).max(2000).allow("").default(""),
    mapLinkText: Joi.string().trim().max(200).allow("").default(""),
  }).required(),
}).custom((value, helpers) => {
  const referenceImageCharacters = value.items.reduce(
    (total, item) => total + item.customisation.referenceImages.reduce((sum, image) => sum + image.length, 0),
    0
  );
  if (referenceImageCharacters > 700000) {
    return helpers.error("custom.referenceImagesTooLarge");
  }
  return value;
});

const verifiedEmailFields = {
  customerEmail: Joi.string().trim().lowercase().email().max(254).required(),
  emailVerificationToken: Joi.string().min(20).max(4096).required(),
};

const createVerifiedEmailOrderSchema = createOrderSchema.keys(verifiedEmailFields);
const verifiedSharedOrderSchema = sharedOrderSchema.keys(verifiedEmailFields);

const orderDetailsSchema = Joi.object({
  version: Joi.number().integer().min(0).required(),
  customerName: Joi.string().trim().max(100).allow("").required(),
  occasion: Joi.string().trim().max(100).allow("").required(),
  occasionDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow("").required(),
  customisation: Joi.object({
    nameOnCake: Joi.string().trim().max(30).allow("").required(),
    eggless: Joi.boolean().required(),
    messageOnCake: Joi.string().trim().max(100).allow("").required(),
    colourChange: Joi.string().trim().max(50).allow("").required(),
    otherRequest: Joi.string().trim().max(200).allow("").required(),
    theme: Joi.string().trim().max(100).allow("").required(),
    designNotes: Joi.string().trim().max(500).allow("").required(),
    tiers: Joi.number().integer().min(1).max(6).allow(null).required(),
    hasAllergy: Joi.boolean().required(),
    allergyNotes: Joi.string().trim().max(300).allow("").required(),
  }).required(),
  delivery: Joi.object({
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    time: Joi.string().trim().min(1).max(50).required(),
    address: Joi.string().trim().max(1000).allow("").required(),
    mapLink: Joi.string().uri({ scheme: ["http", "https"] }).max(2000).allow("").required(),
    mapLinkText: Joi.string().trim().max(200).allow("").required(),
  }).required(),
}).required();

const customerOrderDetailsSchema = orderDetailsSchema.keys({
  phone: phoneSchema,
});

module.exports = {
  createOrderSchema,
  createAdminOrderSchema,
  sharedOrderSchema,
  createVerifiedEmailOrderSchema,
  verifiedSharedOrderSchema,
  orderDetailsSchema,
  customerOrderDetailsSchema,
};
