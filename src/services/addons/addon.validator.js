const Joi = require("joi");
module.exports = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  slug: Joi.string().trim().lowercase().min(2).max(120).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).required(),
  description: Joi.string().trim().max(500).allow("").default(""),
  image: Joi.object({
    url: Joi.string().uri().required(),
    publicId: Joi.string().trim().allow(""),
    width: Joi.number().integer().positive().allow(null),
    height: Joi.number().integer().positive().allow(null),
    alt: Joi.string().trim().max(150).allow(""),
  }).optional(),
  categoryId: Joi.string().hex().length(24).required(),
  price: Joi.number().min(0).required(),
  sortOrder: Joi.number().integer().min(0).default(0),
  isActive: Joi.boolean().default(true),
});
