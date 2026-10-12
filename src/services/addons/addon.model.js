const mongoose = require("mongoose");
const addonSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, trim: true, maxlength: 500, default: "" },
  image: {
    url: { type: String, trim: true, default: "" },
    publicId: { type: String, trim: true, default: "" },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    alt: { type: String, trim: true, default: "" },
  },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true, index: true },
  price: { type: Number, required: true, min: 0 },
  inventoryQuantity: { type: Number, min: 0, default: 0 },
  sortOrder: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false });
addonSchema.index({ categoryId: 1, isActive: 1, sortOrder: 1 });
module.exports = mongoose.model("Addon", addonSchema);
