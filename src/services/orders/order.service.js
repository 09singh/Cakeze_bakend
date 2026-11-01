const { randomBytes } = require("crypto");
const AppError = require("../../utils/AppError");
const Addon = require("../addons/addon.model");
const Category = require("../products/category/category.model");
const Product = require("../products/product.model");
const Order = require("./order.model");
const couponService = require("../coupons/coupon.service");
const { assertDeliverySlotAvailable } = require("./order.delivery-slot");
const { calculateProductPrice } = require("../products/product.pricing");
const clearProductCache = () => require("../products/product.cache").clearProductCache();

async function changeStock(Model, id, amount, code) {
  const result = await Model.updateOne(
    { _id: id, isActive: true, inventoryQuantity: { $gte: amount } },
    { $inc: { inventoryQuantity: -amount } }
  );
  if (result.modifiedCount !== 1) throw new AppError("This item does not have enough stock for your order.", 409, code);
}

const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "");

const createGuestOrder = async (data, createdBy = null) => {
  const phone = normalizePhone(data.phone);
  const previousOrder = await Order.findOne({ checkoutId: data.checkoutId }).lean();
  if (previousOrder) {
    if (
      previousOrder.phone !== phone ||
      (data.customerEmail && previousOrder.customerEmail !== data.customerEmail) ||
      (createdBy?.role === "customer" &&
        String(previousOrder.customer || "") !== String(createdBy._id))
    ) {
      throw new AppError("This checkout has already been used.", 409, "CHECKOUT_ALREADY_USED");
    }
    return previousOrder;
  }

  assertDeliverySlotAvailable(data.delivery);

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
  const cakeUnitPrice = createdBy?.role === "admin" && data.unitPrice !== undefined
    ? Number(data.unitPrice)
    : calculateProductPrice(product, weight, selectedFlavour);
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

  const customerId = createdBy?.role === "customer" ? createdBy._id : null;

  const order = new Order({
    orderId: `CZ${randomBytes(10).toString("hex").toUpperCase()}`,
    checkoutId: data.checkoutId,
    phone,
    customerEmail: data.customerEmail ||
      (createdBy?.role === "customer" ? createdBy.email : null),
    customer: customerId,
    customerName: data.customerName || "",
    occasion: data.occasion || "",
    occasionDate: data.occasionDate || "",
    gstin: data.gstin || "",
    createdBy: createdBy ? { userId: createdBy._id, role: createdBy.role, name: createdBy.name || createdBy.email || "" } : null,
    source: createdBy?.role === "admin" ? "admin" : "website",
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
    if (
      createdOrder?.phone === phone &&
      (!data.customerEmail || createdOrder.customerEmail === data.customerEmail) &&
      (createdBy?.role !== "customer" ||
        String(createdOrder.customer || "") === String(createdBy._id))
    ) return createdOrder;
    throw new AppError("This checkout has already been used.", 409, "CHECKOUT_ALREADY_USED");
  }
};

const createSharedOrder = async (data, customer, customerEmail = null) => {
  const isAuthenticatedCustomer = customer?.role === "customer" && customer._id;
  if (!isAuthenticatedCustomer && !customerEmail) {
    throw new AppError("Verified email is required to place an order.", 401, "EMAIL_VERIFICATION_REQUIRED");
  }
  const email = customerEmail || customer.email || null;
  const phone = normalizePhone(isAuthenticatedCustomer ? customer.phone : data.phone);
  const previousOrder = await Order.findOne({ checkoutId: data.checkoutId }).lean();
  if (previousOrder) {
    if (
      previousOrder.phone !== phone ||
      (email && previousOrder.customerEmail !== email) ||
      (isAuthenticatedCustomer
        ? String(previousOrder.customer || "") !== String(customer._id)
        : previousOrder.customerEmail !== email)
    ) {
      throw new AppError("This checkout has already been used.", 409, "CHECKOUT_ALREADY_USED");
    }
    return previousOrder;
  }

  assertDeliverySlotAvailable(data.delivery);

  const products = await Promise.all(data.items.map(async (item) => {
    const product = await Product.findOne({ _id: item.productId, isActive: true }).lean();
    if (!product) throw new AppError("A selected catalog item is no longer available.", 404, "PRODUCT_NOT_FOUND");
    if (product.productType === "ready_now") {
      throw new AppError("Ready Now products cannot be ordered through this custom-cake form.", 400, "INVALID_PRODUCT_SELECTION");
    }
    const priceFlavour = product.flavours?.[0];
    const selectedSize = item.itemType === "Cake"
      ? product.sizes.find((entry) => entry.name === item.size)
      : null;
    if (
      (item.itemType === "Cake" && !selectedSize) ||
      !priceFlavour ||
      !Number.isFinite(Number(priceFlavour.basePrice)) ||
      Number(priceFlavour.basePrice) < 0
    ) {
      throw new AppError("A selected product size or catalog price is no longer available.", 400, "INVALID_PRODUCT_SELECTION");
    }

    const weight = item.itemType === "Cake"
      ? String(selectedSize.unit || "kg").toLowerCase() === "g"
        ? Number(selectedSize.value) / 1000
        : Number(selectedSize.value)
      : 0;
    const unitPrice = item.itemType === "Cake"
      ? calculateProductPrice(product, weight, priceFlavour)
      : Number(priceFlavour.basePrice);
    return {
      source: item,
      product,
      weight,
      size: item.itemType === "Cake" ? item.size : "piece",
      unitPrice,
      lineTotal: unitPrice * item.quantity,
    };
  }));

  const [firstItem] = products;
  const category = firstItem.product.categoryId
    ? await Category.findById(firstItem.product.categoryId).select("name").lean()
    : null;

  const productQuantities = new Map();
  products.forEach(({ product, source }) => {
    const id = String(product._id);
    productQuantities.set(id, {
      productId: product._id,
      quantity: (productQuantities.get(id)?.quantity || 0) + source.quantity,
    });
  });
  const reservations = [];
  try {
    for (const { productId, quantity } of productQuantities.values()) {
      await changeStock(Product, productId, quantity, "INSUFFICIENT_PRODUCT_STOCK");
      reservations.push({ Model: Product, id: productId, quantity });
    }
  } catch (error) {
    await Promise.all(reservations.map(({ Model, id, quantity }) =>
      Model.updateOne({ _id: id }, { $inc: { inventoryQuantity: quantity } })
    ));
    if (reservations.length) clearProductCache();
    throw error;
  }

  const cakePrice = products.reduce((sum, item) => sum + item.lineTotal, 0);
  const deliveryFee = data.delivery.method === "delivery" ? 60 : 0;
  const subtotal = cakePrice + deliveryFee;
  const items = products.map(({ source, product, weight, unitPrice, lineTotal }) => ({
    productId: product._id,
    name: product.name,
    itemType: source.itemType,
    size: source.itemType === "Cake" ? source.size : "piece",
    weight,
    flavour: source.flavour,
    productImage: product.images?.[0]?.url || "",
    customisation: source.customisation,
    quantity: source.quantity,
    unitPrice,
    lineTotal,
  }));
  const order = new Order({
    orderId: `CZ${randomBytes(10).toString("hex").toUpperCase()}`,
    checkoutId: data.checkoutId,
    phone,
    customer: isAuthenticatedCustomer ? customer._id : null,
    customerEmail: email,
    customerName: data.customerName,
    occasion: data.occasion,
    occasionDate: data.occasionDate || "",
    source: "website",
    items,
    productId: firstItem.product._id,
    productType: firstItem.product.productType || "regular",
    readyNowCategory: firstItem.product.readyNowCategory || "",
    productName: firstItem.product.name,
    productImage: firstItem.product.images?.[0]?.url || "",
    category: category?.name || "",
    size: firstItem.size,
    weight: firstItem.weight,
    flavour: firstItem.source.flavour,
    quantity: firstItem.source.quantity,
    customisation: {
      ...firstItem.source.customisation,
      otherRequest: data.additionalNotes || firstItem.source.customisation.otherRequest || "",
    },
    addons: [],
    delivery: data.delivery,
    pricing: { cakePrice, addonsTotal: 0, deliveryFee, subtotal, discount: 0, total: subtotal },
    payment: { method: "cod", status: "pending" },
    status: "Confirmed",
    statusUpdatedAt: new Date(),
    lifecycleVersion: 0,
    statusHistory: [{
      previous: null,
      next: "Confirmed",
      at: new Date(),
      actor: { userId: null, role: "customer" },
      reason: "Shared order form submitted",
    }],
  });

  try {
    const savedOrder = await order.save();
    clearProductCache();
    return savedOrder;
  } catch (error) {
    await Promise.all(reservations.map(({ Model, id, quantity }) =>
      Model.updateOne({ _id: id }, { $inc: { inventoryQuantity: quantity } })
    ));
    if (reservations.length) clearProductCache();
    if (error.code !== 11000) throw error;
    const createdOrder = await Order.findOne({ checkoutId: data.checkoutId }).lean();
    if (
      createdOrder?.phone === phone &&
      createdOrder?.customerEmail === email &&
      (isAuthenticatedCustomer
        ? String(createdOrder.customer || "") === String(customer._id)
        : createdOrder?.customerEmail === email)
    ) return createdOrder;
    throw new AppError("This checkout has already been used.", 409, "CHECKOUT_ALREADY_USED");
  }
};

const createAdminOrder = async (data, admin) => createGuestOrder(data, admin);

const createCustomerOrder = async (data, customer) => {
  if (!customer || !customer._id) {
    throw new AppError("Customer authentication is required to place an order.", 401, "AUTH_REQUIRED");
  }

  const finalData = {
    ...data,
    phone: customer.phone,
  };

  return createGuestOrder(finalData, customer);
};
module.exports = { createGuestOrder, createAdminOrder, createSharedOrder, createCustomerOrder };
