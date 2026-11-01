const mongoose = require('mongoose');

const posSaleSchema = new mongoose.Schema({
  saleId: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  customerName: { type: String, required: true, trim: true, maxlength: 100 },
  phone: { type: String, required: true, index: true },
  items: [{ productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true }, name: { type: String, required: true }, quantity: { type: Number, required: true, min: 1 }, unitPrice: { type: Number, required: true, min: 0 }, lineTotal: { type: Number, required: true, min: 0 } }],
  total: { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, enum: ['cash', 'upi', 'card'], required: true },
  createdBy: { userId: mongoose.Schema.Types.ObjectId, name: String },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('PosSale', posSaleSchema);
