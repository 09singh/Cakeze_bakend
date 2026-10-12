
require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const User = require("../services/auth/auth.model");

const staffUsers = [
  {
    name: "Cakezee Admin",
    email: "admin@cakezee.com",
    password: "Admin@12345",
    role: "admin",
  },
  {
    name: "Cakezee Kitchen",
    email: "kitchen@cakezee.com",
    password: "Kitchen@12345",
    role: "kitchen",
  },
  {
    name: "Cakezee Delivery",
    email: "delivery@cakezee.com",
    password: "Delivery@12345",
    role: "delivery",
  },
];

async function seedStaff() {
  try {
    // Check MongoDB URI
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in .env");
    }

    console.log("Connecting to MongoDB...");

    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected.");
    console.log("Database:", mongoose.connection.name);
    console.log("Collection:", User.collection.name);

    for (const staff of staffUsers) {
      const cleanEmail = staff.email.trim().toLowerCase();

      const existingUser = await User.findOne({
        email: cleanEmail,
      });

      if (existingUser) {
        console.log(
          `Already exists: ${cleanEmail} (${existingUser.role})`
        );
        continue;
      }

      const passwordHash = await bcrypt.hash(
        staff.password,
        12
      );

      const user = await User.create({
        name: staff.name,
        email: cleanEmail,
        passwordHash,
        role: staff.role,
        isActive: true,
      });

      console.log(
        `Created: ${user.email} (${user.role})`
      );
      console.log(`User ID: ${user._id}`);
    }

    // Verify seeded users
    const totalStaff = await User.countDocuments({
      role: {
        $in: ["admin", "kitchen", "delivery"],
      },
    });

    console.log("--------------------------------");
    console.log(`Total staff users: ${totalStaff}`);
    console.log("Staff seeding completed successfully.");
    console.log("--------------------------------");
  } catch (error) {
    console.error("Seed failed:", error.message);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log("MongoDB disconnected.");
    }
  }
}

seedStaff();
