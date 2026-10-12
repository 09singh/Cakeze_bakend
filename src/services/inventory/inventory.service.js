const mongoose = require("mongoose");
const Product = require("../products/product.model");
const Addon = require("../addons/addon.model");
const AppError = require("../../utils/AppError");

async function listInventory() {
  const [products, addons] = await Promise.all([
    Product.find({ isActive: true }).select("name slug images categoryId inventoryQuantity").populate("categoryId", "name").sort({ name: 1 }).lean(),
    Addon.find({ isActive: true }).select("name slug image categoryId price inventoryQuantity").populate("categoryId", "name").sort({ name: 1 }).lean(),
  ]);
  return {
    products: products.map((item) => ({ ...item, kind: "product", image: item.images?.[0]?.url || "" })),
    addons: addons.map((item) => ({ ...item, kind: "addon" })),
  };
}

async function setInventory(kind, id, quantity) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError("Invalid item ID.", 400, "INVALID_ITEM_ID");
  const Model = kind === "product" ? Product : kind === "addon" ? Addon : null;
  if (!Model) throw new AppError("Item type must be product or addon.", 400, "INVALID_ITEM_TYPE");
  const item = await Model.findByIdAndUpdate(id, { $set: { inventoryQuantity: quantity } }, { new: true, runValidators: true }).lean();
  if (!item) throw new AppError("Inventory item not found.", 404, "ITEM_NOT_FOUND");
  if (kind === "product") require("../products/product.cache").clearProductCache();
  return { ...item, kind };
}

module.exports = { listInventory, setInventory };
