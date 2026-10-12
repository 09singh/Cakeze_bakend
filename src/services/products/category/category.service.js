
const mongoose = require("mongoose");

const Category = require("./category.model");
const Product = require("../product.model");
const cloudinary = require("../../../config/cloudinary");

const uploadBufferToCloudinary = require(
  "../../../utils/cloudinaryUpload"
);

/*
|--------------------------------------------------------------------------
| CREATE CATEGORY
|--------------------------------------------------------------------------
*/

const createCategory = async (categoryData, imageFile) => {
  const {
    name,
    slug,
    description,
    isActive,
    sortOrder,
  } = categoryData;

  // Check duplicate name or slug
  const existingCategory = await Category.findOne({
    $or: [
      { slug },
      { name: name.trim() },
    ],
  })
    .select("_id name slug")
    .lean();

  if (existingCategory) {
    const error = new Error(
      existingCategory.slug === slug
        ? "A category with this slug already exists"
        : "A category with this name already exists"
    );

    error.statusCode = 409;
    throw error;
  }

  // Default image data
  let image = {
    url: "",
    publicId: null,
    alt: name.trim(),
  };

  // Upload image to Cloudinary if provided
  if (imageFile) {
    const uploadResult = await uploadBufferToCloudinary(
      imageFile.buffer,
      {
        folder: "cakezee/categories",
      }
    );

    image = {
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      alt: name.trim(),
    };
  }

  const category = await Category.create({
    name,
    slug,
    description,
    image,
    isActive,
    sortOrder,
  });

  return category;
};

/*
|--------------------------------------------------------------------------
| GET ACTIVE CATEGORIES - CUSTOMER
|--------------------------------------------------------------------------
*/

const getActiveCategories = async () => {
  return Category.find({
    isActive: true,
  })
    .select("_id name slug description image sortOrder isActive")
    .sort({
      sortOrder: 1,
      name: 1,
    })
    .lean();
};

/*
|--------------------------------------------------------------------------
| GET ALL CATEGORIES - ADMIN
|--------------------------------------------------------------------------
*/

const getAllCategories = async () => {
  return Category.find({})
    .select("_id name slug description image sortOrder isActive")
    .sort({
      sortOrder: 1,
      name: 1,
    })
    .lean();
};

/*
|--------------------------------------------------------------------------
| VALIDATE CATEGORY ID
|--------------------------------------------------------------------------
*/

const validateCategoryId = (categoryId) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    const error = new Error("Invalid category ID");
    error.statusCode = 400;
    throw error;
  }
};

/*
|--------------------------------------------------------------------------
| DEACTIVATE CATEGORY
|--------------------------------------------------------------------------
*/

const deactivateCategory = async (categoryId) => {
  validateCategoryId(categoryId);

  const category = await Category.findByIdAndUpdate(
    categoryId,
    {
      $set: {
        isActive: false,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  )
    .select("_id name slug isActive")
    .lean();

  if (!category) {
    const error = new Error("Category not found");
    error.statusCode = 404;
    throw error;
  }

  return category;
};

/*
|--------------------------------------------------------------------------
| ACTIVATE CATEGORY
|--------------------------------------------------------------------------
*/

const activateCategory = async (categoryId) => {
  validateCategoryId(categoryId);

  const category = await Category.findByIdAndUpdate(
    categoryId,
    {
      $set: {
        isActive: true,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  )
    .select("_id name slug isActive")
    .lean();

  if (!category) {
    const error = new Error("Category not found");
    error.statusCode = 404;
    throw error;
  }

  return category;
};

/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

const removeCategory = async (categoryId) => {
  validateCategoryId(categoryId);
  const category = await Category.findById(categoryId);
  if (!category) {
    const error = new Error("Category not found");
    error.statusCode = 404;
    throw error;
  }
  if (await Product.exists({ categoryId })) {
    const error = new Error("This category is assigned to products. Deactivate it instead or reassign those products first.");
    error.statusCode = 409;
    throw error;
  }
  if (category.image?.publicId) {
    await cloudinary.uploader.destroy(category.image.publicId, { resource_type: "image" });
  }
  await category.deleteOne();
  return { _id: categoryId };
};

module.exports = {
  createCategory,
  getActiveCategories,
  getAllCategories,
  deactivateCategory,
  activateCategory,
  removeCategory,
};