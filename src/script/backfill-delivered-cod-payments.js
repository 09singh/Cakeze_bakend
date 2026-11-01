require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const mongoose = require("mongoose");
const Order = require("../services/orders/order.model");

async function backfillDeliveredCodPayments() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGO_URI is not configured.");

  await mongoose.connect(mongoUri);
  const orders = await Order.find({
    status: /^delivered$/i,
    "payment.status": { $ne: "paid" },
    "payment.method": { $in: ["cod", "cash"] },
  })
    .select("_id orderId status payment pricing statusHistory statusUpdatedAt updatedAt assignedDelivery lifecycleVersion")
    .lean();

  let updatedCount = 0;
  let updatedAmount = 0;

  for (const order of orders) {
    const deliveredEvent = [...(order.statusHistory || [])]
      .reverse()
      .find((event) => String(event.next || "").trim().toLowerCase() === "delivered");
    const recordedAt = order.payment?.recordedAt ||
      deliveredEvent?.at ||
      order.statusUpdatedAt ||
      order.updatedAt ||
      new Date();
    const amount = Number(order.pricing?.total || 0);
    const recordedBy = order.payment?.recordedBy ||
      deliveredEvent?.actor || {
        userId: order.assignedDelivery || null,
        role: "delivery",
        name: "Delivery staff",
      };
    const result = await Order.updateOne(
      {
        _id: order._id,
        status: order.status,
        "payment.status": { $ne: "paid" },
        "payment.method": order.payment?.method,
      },
      {
        $set: {
          "payment.status": "paid",
          "payment.collectedAmount": amount,
          "payment.method": "cash",
          "payment.recordedBy": recordedBy,
          "payment.recordedAt": recordedAt,
        },
        $push: {
          paymentHistory: {
            previous: order.payment?.status || "pending",
            next: "paid",
            amount,
            method: "cash",
            at: recordedAt,
            actor: recordedBy,
          },
        },
        $inc: { lifecycleVersion: 1 },
      },
      { runValidators: true }
    );

    updatedCount += result.modifiedCount;
    if (result.modifiedCount) updatedAmount += amount;
  }

  console.log(JSON.stringify({ updatedCount, updatedAmount }));
}

backfillDeliveredCodPayments()
  .catch((error) => {
    console.error("Could not backfill delivered COD payments:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
