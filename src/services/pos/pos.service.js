const { randomBytes, randomUUID } = require('crypto');
const AppError = require('../../utils/AppError');
const Product = require('../products/product.model');
const PosSale = require('./pos.model');
const Order = require('../orders/order.model');
const clearProductCache = () => require('../products/product.cache').clearProductCache();

async function listProducts() {
  return Product.find({ productType: 'ready_now' })
    .select('name slug description readyNowCategory images flavours inventoryQuantity isActive')
    .sort({ readyNowCategory: 1, name: 1 }).lean();
}

async function createProduct(data, imageFiles) {
  const product = await require('../products/product.service').createReadyNowProduct(data, imageFiles);
  return product;
}

async function updateProduct(id, { inventoryQuantity, isActive }) {
  const update = {};
  if (inventoryQuantity !== undefined) update.inventoryQuantity = inventoryQuantity;
  if (isActive !== undefined) update.isActive = isActive;
  const product = await Product.findOneAndUpdate(
    { _id: id, productType: 'ready_now' }, { $set: update }, { new: true, runValidators: true }
  ).select('name slug readyNowCategory images flavours inventoryQuantity isActive').lean();
  if (!product) throw new AppError('Ready Now product not found.', 404, 'PRODUCT_NOT_FOUND');
  clearProductCache();
  return product;
}

async function createSale(data, manager) {
  const phone = data.phone.replace(/\D/g, '');
  const productIds = data.items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) throw new AppError('Add each product once and adjust its quantity.', 400, 'DUPLICATE_PRODUCT');
  const products = await Product.find({ _id: { $in: productIds }, productType: 'ready_now', isActive: true }).lean();
  if (products.length !== data.items.length) throw new AppError('One or more products are no longer available.', 409, 'PRODUCT_UNAVAILABLE');
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const lines = data.items.map((item) => {
    const product = productMap.get(item.productId);
    const unitPrice = Number(product.flavours?.[0]?.basePrice || 0);
    if (unitPrice <= 0) throw new AppError(`${product.name} has no valid POS price.`, 409, 'INVALID_PRODUCT_PRICE');
    return { product, quantity: item.quantity, unitPrice, lineTotal: unitPrice * item.quantity };
  });
  const reserved = [];
  let order = null;
  try {
    for (const line of lines) {
      const result = await Product.updateOne({ _id: line.product._id, productType: 'ready_now', isActive: true, inventoryQuantity: { $gte: line.quantity } }, { $inc: { inventoryQuantity: -line.quantity } });
      if (result.modifiedCount !== 1) throw new AppError(`${line.product.name} does not have enough stock.`, 409, 'INSUFFICIENT_STOCK');
      reserved.push(line);
    }
    const saleId = `POS${randomBytes(8).toString('hex').toUpperCase()}`;
    const orderId = `CZ${randomBytes(10).toString('hex').toUpperCase()}`;
    const now = new Date();
    const orderItems = lines.map(({ product, quantity, unitPrice, lineTotal }) => ({ productId: product._id, name: product.name, quantity, unitPrice, lineTotal }));
    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const actor = { userId: manager._id, role: 'manager', name: manager.name || manager.email || 'Manager' };
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const time = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(now);
    order = await Order.create({
      orderId,
      checkoutId: randomUUID(),
      phone,
      customerName: data.customerName.trim(),
      createdBy: actor,
      source: 'pos',
      items: orderItems,
      productId: lines[0].product._id,
      productType: 'ready_now',
      readyNowCategory: lines[0].product.readyNowCategory || '',
      productName: `POS sale: ${orderItems.map((item) => `${item.name} × ${item.quantity}`).join(', ')}`,
      productImage: lines[0].product.images?.[0]?.url || '',
      category: 'Ready Now',
      size: 'Counter sale',
      weight: 1,
      flavour: 'Standard',
      quantity: 1,
      customisation: { paymentPreference: data.paymentMethod === 'cash' ? 'cash' : 'upi' },
      addons: [],
      delivery: { method: 'pickup', date, time, address: '' },
      pricing: { cakePrice: total, addonsTotal: 0, deliveryFee: 0, subtotal: total, discount: 0, total },
      payment: { method: data.paymentMethod, status: 'paid', collectedAmount: total, recordedBy: actor, recordedAt: now },
      status: 'Delivered',
      statusUpdatedAt: now,
      lifecycleVersion: 1,
      statusHistory: [{ previous: null, next: 'Delivered', at: now, actor, reason: 'POS counter sale completed' }],
      paymentHistory: [{ previous: 'pending', next: 'paid', amount: total, method: data.paymentMethod, at: now, actor }],
    });
    const sale = await PosSale.create({
      saleId,
      orderId,
      customerName: data.customerName.trim(), phone,
      items: orderItems,
      total,
      paymentMethod: data.paymentMethod,
      createdBy: { userId: manager._id, name: manager.name || manager.email || 'Manager' },
    });
    clearProductCache();
    return sale;
  } catch (error) {
    if (order) await Order.deleteOne({ _id: order._id });
    await Promise.all(reserved.map(({ product, quantity }) => Product.updateOne({ _id: product._id }, { $inc: { inventoryQuantity: quantity } })));
    if (reserved.length) clearProductCache();
    throw error;
  }
}

async function listSales() {
  return PosSale.find().sort({ createdAt: -1 }).limit(500).lean();
}

module.exports = { listProducts, createProduct, updateProduct, createSale, listSales };
