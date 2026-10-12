const mongoose = require("mongoose");
const Addon = require("./addon.model");
const Category = require("../products/category/category.model");
const uploadBufferToCloudinary = require("../../utils/cloudinaryUpload");
const notFound = () => { const e = new Error("Add-on not found"); e.statusCode = 404; return e; };
const getActiveAddons = async ({ categorySlug, categoryId } = {}) => {
  const query = { isActive: true, inventoryQuantity: { $gt: 0 } };
  if (categorySlug) { const category = await Category.findOne({ slug: String(categorySlug).toLowerCase(), isActive: true }).select("_id").lean(); if (!category) return []; query.categoryId = category._id; }
  if (categoryId) { if (!mongoose.Types.ObjectId.isValid(categoryId)) return []; query.categoryId = categoryId; }
  return Addon.find(query).select("_id name slug description image categoryId price sortOrder isActive inventoryQuantity").sort({ sortOrder: 1, name: 1 }).lean();
};
const getAdminAddons = async () => Addon.find({}).populate("categoryId", "name slug").sort({ categoryId: 1, sortOrder: 1, name: 1 }).lean();
const createAddon = async (data, imageFile) => {
  const category = await Category.findOne({ _id: data.categoryId, isActive: true }).select("_id").lean();
  if (!category) { const e = new Error("Category not found or inactive"); e.statusCode = 400; throw e; }
  if (await Addon.exists({ slug: data.slug })) { const e = new Error("An add-on with this slug already exists"); e.statusCode = 409; throw e; }
  if (imageFile) {
    const result = await uploadBufferToCloudinary(imageFile.buffer, {
      folder: "cakezee/addons",
    });
    data.image = {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      alt: data.name,
    };
  }
  return Addon.create(data);
};
const removeAddon = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) { const e = new Error("Invalid add-on ID"); e.statusCode = 400; throw e; }
  const result = await Addon.findByIdAndDelete(id); if (!result) throw notFound();
};
module.exports = { getActiveAddons, getAdminAddons, createAddon, removeAddon };
