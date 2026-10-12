
const path = require("path");
const dotenv = require("dotenv");

// Explicitly load Backend/.env
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

const cloudinary = require("cloudinary").v2;

const {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
} = process.env;

console.log("Cloudinary env check:", {
  cloudName: Boolean(CLOUDINARY_CLOUD_NAME),
  apiKey: Boolean(CLOUDINARY_API_KEY),
  apiSecret: Boolean(CLOUDINARY_API_SECRET),
});

if (
  !CLOUDINARY_CLOUD_NAME ||
  !CLOUDINARY_API_KEY ||
  !CLOUDINARY_API_SECRET
) {
  throw new Error(
    "Cloudinary environment variables missing. Check Backend/.env"
  );
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;