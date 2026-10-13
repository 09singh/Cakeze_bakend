const { randomBytes } = require("crypto");
const AppError = require("../../utils/AppError");
const Addon = require("../addons/addon.model");
const Category = require("../products/category/category.model");
const Product = require("../products/product.model");
const Order = require("./order.model");
const couponService = require("../coupons/coupon.service");
const clearProductCache = () => require("../products/product.cache").clearProductCache();

async function changeStock(Model, id, amount, code) {
  const result = await Model.updateOne(
    { _id: id, isActive: true, inventoryQuantity: { $gte: amount } },
    { $inc: { inventoryQuantity: -amount } }
  );
  if (result.modifiedCount !== 1) throw new AppError("This item does not have enough stock for your order.", 409, code);
}

const normalizePhone = (phone) => phone.replace(/\D/g, "");

const createGuestOrder = async (data, createdBy = null) => {
  const phone = normalizePhone(data.phone);
  const previousOrder = await Order.findOne({ checkoutId: data.checkoutId }).lean();
  if (previousOrder) {
    if (previousOrder.phone !== phone) {
      throw new AppError("This checkout has already been used.", 409, "CHECKOUT_ALREADY_USED");
    }
    return previousOrder;
  }

  const product = await Product.findOne({ _id: data.productId, isActive: true }).lean();
  if (!product) throw new AppError("This product is no longer available.", 404, "PRODUCT_NOT_FOUND");

  const selectedSize = product.sizes.find((size) => size.name === data.size);
  const selectedFlavour = product.flavours.find((flavour) => flavour.name === data.flavour);
  if (!selectedSize || !selectedFlavour) {
    throw new AppError("The selected size or flavour is no longer available.", 400, "INVALID_PRODUCT_SELECTION");
  }

  const weight = String(selectedSize.unit || "kg").toLowerCase() === "g"
    ? Number(selectedSize.value) / 1000
    : Number(selectedSize.value);
  const calculatedUnitPrice = Number(selectedFlavour.basePrice) *
    (weight / (Number(product.pricing?.baseWeight) || 0.5));
  const cakeUnitPrice = data.unitPrice === undefined ? calculatedUnitPrice : Number(data.unitPrice);
  const cakePrice = cakeUnitPrice * data.quantity;

  const selectedAddons = data.addonIds.length
    ? await Addon.find({
      _id: { $in: data.addonIds },
      categoryId: product.categoryId,
      isActive: true,
    }).select("_id name price").lean()
    : [];
  if (selectedAddons.length !== data.addonIds.length) {
    throw new AppError("One or more selected add-ons are no longer available.", 400, "INVALID_ADDON_SELECTION");
  }

  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + addon.price, 0) * data.quantity;
  const deliveryFee = data.delivery.method === "delivery"
    ? (data.deliveryFee === undefined ? 60 : Number(data.deliveryFee))
    : 0;
  const subtotal = cakePrice + addonsTotal + deliveryFee;
  const couponCode = data.couponCode ? String(data.couponCode).trim().toUpperCase() : null;
  const couponDetails = couponCode ? await couponService.validateCoupon(couponCode) : null;
  const discountValue = couponDetails?.discountValue || 0;
  const discount = Math.round(subtotal * discountValue / 100);
  const total = Math.max(0, subtotal - discount);
  const category = product.categoryId
    ? await Category.findById(product.categoryId).select("name").lean()
    : null;

  // Reserve stock atomically before accepting the order so concurrent checkouts cannot oversell.
  const reservations = [];
  let couponReserved = false;
  try {
    if (couponCode) {
      await couponService.reserveCoupon(couponCode);
      couponReserved = true;
    }
    await changeStock(Product, product._id, data.quantity, "INSUFFICIENT_PRODUCT_STOCK");
    reservations.push({ Model: Product, id: product._id, quantity: data.quantity });
    for (const addon of selectedAddons) {
      const quantity = data.quantity;
      await changeStock(Addon, addon._id, quantity, "INSUFFICIENT_ADDON_STOCK");
      reservations.push({ Model: Addon, id: addon._id, quantity });
    }
  } catch (error) {
    await Promise.all(reservations.map(({ Model, id, quantity }) => Model.updateOne({ _id: id }, { $inc: { inventoryQuantity: quantity } })));
    if (couponReserved) await couponService.releaseCoupon(couponCode);
    if (reservations.length) clearProductCache();
    throw error;
  }

  const order = new Order({
    orderId: `CZ${randomBytes(10).toString("hex").toUpperCase()}`,
    checkoutId: data.checkoutId,
    phone,
    customerName: data.customerName || "",
    occasion: data.occasion || "",
    occasionDate: data.occasionDate || "",
    gstin: data.gstin || "",
    createdBy: createdBy ? { userId: createdBy._id, role: createdBy.role, name: createdBy.name || createdBy.email || "" } : null,
    productId: product._id,
    productType: product.productType || "regular",
    readyNowCategory: product.readyNowCategory || "",
    productName: product.name,
    productImage: product.images?.[0]?.url || "",
    category: category?.name || "",
    size: selectedSize.name,
    weight,
    flavour: selectedFlavour.name,
    quantity: data.quantity,
    customisation: data.customisation,
    addons: selectedAddons.map((addon) => ({
      addonId: addon._id,
      name: addon.name,
      price: addon.price,
    })),
    delivery: data.delivery,
    pricing: {
      cakePrice,
      addonsTotal,
      deliveryFee,
      subtotal,
      discount,
      total,
    },
    coupon: discountValue
      ? { code: couponCode, discountType: "percentage", discountValue }
      : null,
    payment: { method: data.paymentMethod, status: "pending" },
    status: "Confirmed",
    statusUpdatedAt: new Date(),
    lifecycleVersion: 0,
    statusHistory: [{ previous: null, next: "Confirmed", at: new Date(), actor: createdBy ? { userId: createdBy._id, role: createdBy.role, name: createdBy.name || createdBy.email || "" } : { userId: null, role: "customer" }, reason: createdBy ? "Admin order created" : "Order created" }],
  });

  try {
    const savedOrder = await order.save();
    clearProductCache();
    return savedOrder;
  } catch (error) {
    await Promise.all(reservations.map(({ Model, id, quantity }) => Model.updateOne({ _id: id }, { $inc: { inventoryQuantity: quantity } })));
    if (couponReserved) await couponService.releaseCoupon(couponCode);
    if (reservations.length) clearProductCache();
    if (error.code !== 11000) throw error;
    const createdOrder = await Order.findOne({ checkoutId: data.checkoutId }).lean();
    if (createdOrder?.phone === phone) return createdOrder;
    throw new AppError("This checkout has already been used.", 409, "CHECKOUT_ALREADY_USED");
  }
};

const createAdminOrder = async (data, admin) => createGuestOrder(data, admin);

const getGuestOrder = async ({ phone, orderId }) => {
  const order = await Order.findOne({
    phone: normalizePhone(phone),
    orderId,
  }).lean();
  if (!order) throw new AppError("No order matched that phone number and reference.", 404, "ORDER_NOT_FOUND");
  return order;
};

module.exports = { createGuestOrder, createAdminOrder, getGuestOrder };


