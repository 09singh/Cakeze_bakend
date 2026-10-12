const Joi = require("joi");

const createCategorySchema =
  Joi.object({
    name: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .required(),

    slug: Joi.string()
      .trim()
      .lowercase()
      .min(2)
      .max(120)
      .pattern(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/
      )
      .required(),

    description: Joi.string()
      .trim()
      .max(500)
      .allow("")
      .default(""),

    isActive: Joi.boolean()
      .default(true),

    sortOrder: Joi.number()
      .integer()
      .min(0)
      .default(0),
  });

module.exports = {
  createCategorySchema,
};