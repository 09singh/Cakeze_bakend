const mongoose = require("mongoose");

/*
|--------------------------------------------------------------------------
| Product Image
|--------------------------------------------------------------------------
*/

const imageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },

    publicId: {
      type: String,
      trim: true,
      default: null,
    },

    width: {
      type: Number,
      default: null,
    },

    height: {
      type: Number,
      default: null,
    },

    alt: {
      type: String,
      trim: true,
      default: "",
      maxlength: 150,
    },
  },
  {
    _id: false,
  }
);

/*
|--------------------------------------------------------------------------
| Available Weight / Size
|--------------------------------------------------------------------------
|
| Example:
|
| 0.5 kg
| 1 kg
| 1.5 kg
| 2 kg
|
| Price is NOT stored here.
|
| Price is calculated from:
|
| flavour.basePrice × weight / baseWeight
|
|--------------------------------------------------------------------------
*/

const sizeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    value: {
      type: Number,
      required: true,
      min: 0.1,
    },

    unit: {
      type: String,
      trim: true,
      lowercase: true,
      default: "kg",
    },
  },
  {
    _id: false,
  }
);

/*
|--------------------------------------------------------------------------
| Flavour Pricing
|--------------------------------------------------------------------------
|
| basePrice = price of this flavour for baseWeight.
|
| Example:
|
| baseWeight = 0.5kg
|
| Chocolate    = ₹250
| Vanilla      = ₹300
| Butterscotch = ₹350
|
|--------------------------------------------------------------------------
*/

const flavourSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    basePrice: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    _id: false,
  }
);

/*
|--------------------------------------------------------------------------
| Pricing Configuration
|--------------------------------------------------------------------------
*/

const pricingSchema = new mongoose.Schema(
  {
    baseWeight: {
      type: Number,
      required: true,
      min: 0.1,
      default: 0.5,
    },

    weightUnit: {
      type: String,
      trim: true,
      lowercase: true,
      default: "kg",
    },

    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "INR",
    },
  },
  {
    _id: false,
  }
);

/*
|--------------------------------------------------------------------------
| Product Schema
|--------------------------------------------------------------------------
*/

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 150,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    /*
     * Product belongs to one category.
     *
     * Add-ons are NOT stored here.
     * Add-ons are category based and handled separately.
     */
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      index: true,
    },
    productType: { type: String, enum: ["regular", "ready_now"], default: "regular", index: true },
    readyNowCategory: { type: String, enum: ["cake", "benetto", "dessert", "pastries", "combos"], default: null, index: true },

    images: {
      type: [imageSchema],
      default: [],
    },

    /*
     * Available cake weights.
     */
    sizes: {
      type: [sizeSchema],
      default: [],
    },

    /*
     * Flavour-specific pricing.
     */
    flavours: {
      type: [flavourSchema],
      default: [],
    },

    /*
     * Pricing configuration.
     */
    pricing: {
      type: pricingSchema,
      required: true,
      default: () => ({
        baseWeight: 0.5,
        weightUnit: "kg",
        currency: "INR",
      }),
    },

    badge: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    inventoryQuantity: { type: Number, min: 0, default: 0 },

    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
*/

productSchema.index({
  categoryId: 1,
  isActive: 1,
  sortOrder: 1,
});

productSchema.index({
  isActive: 1,
  sortOrder: 1,
});

const Product = mongoose.model(
  "Product",
  productSchema
);

module.exports = Product;
