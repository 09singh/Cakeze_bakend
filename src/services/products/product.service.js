const mongoose = require("mongoose");

const Product = require("./product.model");
const Category = require("../products/category/category.model");
const cloudinary = require("../../config/cloudinary");
const uploadBufferToCloudinary = require("../../utils/cloudinaryUpload");

const {
  getCache,
  setCache,
  deleteCache,
  invalidateByPrefix,
  getProductListCacheKey,
  getProductByIdCacheKey,
  getProductBySlugCacheKey,
  getProductsByCategoryCacheKey,
} = require("./product.cache");

const {
  CUSTOMER_PRODUCT_PROJECTION,
  CUSTOMER_PRODUCT_DETAIL_PROJECTION,
  ADMIN_PRODUCT_PROJECTION,
  buildCustomerFilter,
  buildAdminFilter,
  buildPagination,
  buildSort,
} = require("./product.query");

const PRODUCT_CONSTANTS = require("./product.constants");

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

/*
|--------------------------------------------------------------------------
| Validate Category
|--------------------------------------------------------------------------
*/

const validateCategory = async (categoryId) => {
  if (!isValidObjectId(categoryId)) {
    const error = new Error(
      "Invalid category ID"
    );

    error.statusCode = 400;

    throw error;
  }

  const category =
    await Category.findOne({
      _id: categoryId,
      isActive: true,
    })
      .select("_id")
      .lean();

  if (!category) {
    const error = new Error(
      "Category not found or inactive"
    );

    error.statusCode = 400;

    throw error;
  }

  return category;
};

/*
|--------------------------------------------------------------------------
| Validate Pricing
|--------------------------------------------------------------------------
|
| Example:
|
| baseWeight = 0.5
|
| 0.5kg → multiplier 1
| 1kg   → multiplier 2
| 1.5kg → multiplier 3
| 2kg   → multiplier 4
|
|--------------------------------------------------------------------------
*/

const validatePricingConfiguration = ({
  pricing,
  sizes,
  flavours,
}) => {
  if (!pricing?.baseWeight) {
    const error = new Error(
      "Pricing base weight is required"
    );

    error.statusCode = 400;

    throw error;
  }

  if (!Array.isArray(sizes) || !sizes.length) {
    const error = new Error(
      "At least one product size is required"
    );

    error.statusCode = 400;

    throw error;
  }

  if (
    !Array.isArray(flavours) ||
    !flavours.length
  ) {
    const error = new Error(
      "At least one flavour is required"
    );

    error.statusCode = 400;

    throw error;
  }

  const baseWeight =
    Number(pricing.baseWeight);

  /*
   * Every weight should be equal to or greater
   * than the base weight.
   */
  const invalidWeight = sizes.find(
    (size) =>
      Number(size.value) < baseWeight
  );

  if (invalidWeight) {
    const error = new Error(
      `Product size ${invalidWeight.value}${invalidWeight.unit} cannot be smaller than base weight ${baseWeight}${pricing.weightUnit}`
    );

    error.statusCode = 400;

    throw error;
  }

  /*
   * Prevent duplicate flavour names.
   */
  const flavourNames =
    flavours.map((flavour) =>
      flavour.name.trim().toLowerCase()
    );

  const uniqueFlavourNames =
    new Set(flavourNames);

  if (
    uniqueFlavourNames.size !==
    flavourNames.length
  ) {
    const error = new Error(
      "Duplicate flavour names are not allowed"
    );

    error.statusCode = 400;

    throw error;
  }

  /*
   * Prevent duplicate weights.
   */
  const weightValues = sizes.map(
    (size) =>
      `${size.value}-${size.unit.toLowerCase()}`
  );

  const uniqueWeights =
    new Set(weightValues);

  if (
    uniqueWeights.size !==
    weightValues.length
  ) {
    const error = new Error(
      "Duplicate product weights are not allowed"
    );

    error.statusCode = 400;

    throw error;
  }
};

/*
|--------------------------------------------------------------------------
| Clean Update Data
|--------------------------------------------------------------------------
*/

const cleanUpdateData = (data) => {
  return Object.fromEntries(
    Object.entries(data).filter(
      ([, value]) =>
        value !== undefined
    )
  );
};

/*
|--------------------------------------------------------------------------
| Cache Invalidation
|--------------------------------------------------------------------------
*/

const invalidateProductCaches = ({
  productId,
  slug,
  categoryId,
} = {}) => {
  if (productId) {
    deleteCache(
      getProductByIdCacheKey(productId)
    );
  }

  if (slug) {
    deleteCache(
      getProductBySlugCacheKey(slug)
    );
  }

  if (categoryId) {
    invalidateByPrefix(
      `${PRODUCT_CONSTANTS.CACHE_KEYS.PRODUCTS_BY_CATEGORY}:${categoryId}`
    );
  }

  invalidateByPrefix(
    PRODUCT_CONSTANTS.CACHE_KEYS.ALL_PRODUCTS
  );
};

/*
|--------------------------------------------------------------------------
| CREATE PRODUCT
|--------------------------------------------------------------------------
*/

const createProduct = async (
  productData,
  imageFiles = []
) => {
  const {
    name,
    slug,
    description,
    categoryId,
    images,
    sizes,
    flavours,
    pricing,
    badge,
    isActive,
    sortOrder,
  } = productData;

  /*
   * Validate category only on write.
   */
  await validateCategory(categoryId);

  /*
   * Validate pricing configuration.
   */
  validatePricingConfiguration({
    pricing,
    sizes,
    flavours,
  });

  /*
   * Check slug.
   */
  const existingProduct =
    await Product.findOne({
      slug,
    })
      .select("_id")
      .lean();

  if (existingProduct) {
    const error = new Error(
      "A product with this slug already exists"
    );

    error.statusCode = 409;

    throw error;
  }

  const uploadedImages = await Promise.all(imageFiles.map(async (file) => {
    const result = await uploadBufferToCloudinary(file.buffer, { folder: "cakezee/products" });
    return { url: result.secure_url, publicId: result.public_id, width: result.width, height: result.height, alt: name };
  }));

  const product =
    await Product.create({
      name,
      slug,
      description,
      categoryId,
      images: uploadedImages.length ? uploadedImages : images,
      sizes,
      flavours,
      pricing,
      badge,
      isActive,
      sortOrder,
    });

  invalidateProductCaches({
    productId:
      product._id.toString(),

    slug: product.slug,

    categoryId:
      product.categoryId.toString(),
  });

  return product;
};

/*
|--------------------------------------------------------------------------
| GET CUSTOMER PRODUCTS
|--------------------------------------------------------------------------
*/

const getCustomerProducts = async (
  query
) => {
  const {
    categoryId,
    search,
    page,
    limit,
    sort,
  } = query;

  const pagination =
    buildPagination({
      page,
      limit,
    });

  const filter =
    buildCustomerFilter({
      categoryId,
      search,
    });

  const cacheKey = categoryId
    ? getProductsByCategoryCacheKey(
        categoryId,
        {
          page: pagination.page,
          limit: pagination.limit,
          sort,
          search: search || "",
        }
      )
    : getProductListCacheKey({
        page: pagination.page,
        limit: pagination.limit,
        sort,
        search: search || "",
      });

  const cachedResult =
    getCache(cacheKey);

  if (cachedResult) {
    return cachedResult;
  }

  /*
   * Fetch one extra document.
   *
   * This avoids countDocuments().
   */
  const products =
    await Product.find(filter)
      .select(
        CUSTOMER_PRODUCT_PROJECTION
      )
      .sort(buildSort(sort))
      .skip(pagination.skip)
      .limit(pagination.limit + 1)
      .lean();

  const hasNext =
    products.length >
    pagination.limit;

  if (hasNext) {
    products.pop();
  }

  const result = {
    products,

    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      hasNext,
    },
  };

  setCache(
    cacheKey,
    result,
    PRODUCT_CONSTANTS.CACHE_TTL
  );

  return result;
};

/*
|--------------------------------------------------------------------------
| GET CUSTOMER PRODUCT BY ID
|--------------------------------------------------------------------------
*/

const getCustomerProductById =
  async (productId) => {
    if (!isValidObjectId(productId)) {
      const error = new Error(
        "Invalid product ID"
      );

      error.statusCode = 400;

      throw error;
    }

    const cacheKey =
      getProductByIdCacheKey(
        `customer:${productId}`
      );

    const cachedProduct =
      getCache(cacheKey);

    if (cachedProduct) {
      return cachedProduct;
    }

    const product =
      await Product.findOne({
        _id: productId,
        isActive: true,
      inventoryQuantity: { $gt: 0 },
      })
        .select(
          CUSTOMER_PRODUCT_DETAIL_PROJECTION
        )
        .populate("categoryId", "name slug")
        .lean();

    if (!product) {
      const error = new Error(
        "Product not found"
      );

      error.statusCode = 404;

      throw error;
    }

    setCache(
      cacheKey,
      product,
      PRODUCT_CONSTANTS.CACHE_TTL
    );

    return product;
  };

/*
|--------------------------------------------------------------------------
| GET CUSTOMER PRODUCT BY SLUG
|--------------------------------------------------------------------------
*/

const getCustomerProductBySlug =
  async (slug) => {
    const cacheKey =
      getProductBySlugCacheKey(
        `customer:${slug}`
      );

    const cachedProduct =
      getCache(cacheKey);

    if (cachedProduct) {
      return cachedProduct;
    }

    const product =
      await Product.findOne({
        slug,
        isActive: true,
        inventoryQuantity: { $gt: 0 },
      })
        .select(
          CUSTOMER_PRODUCT_DETAIL_PROJECTION
        )
        .populate("categoryId", "name slug")
        .lean();

    if (!product) {
      const error = new Error(
        "Product not found"
      );

      error.statusCode = 404;

      throw error;
    }

    setCache(
      cacheKey,
      product,
      PRODUCT_CONSTANTS.CACHE_TTL
    );

    return product;
  };

/*
|--------------------------------------------------------------------------
| GET ADMIN PRODUCTS
|--------------------------------------------------------------------------
*/

const getAdminProducts = async (
  query
) => {
  const {
    categoryId,
    isActive,
    search,
    page,
    limit,
    sort,
  } = query;

  const pagination =
    buildPagination({
      page,
      limit,
    });

  const filter =
    buildAdminFilter({
      categoryId,
      isActive,
      search,
    });

  const products =
    await Product.find(filter)
      .select(
        ADMIN_PRODUCT_PROJECTION
      )
      .sort(buildSort(sort))
      .skip(pagination.skip)
      .limit(pagination.limit + 1)
      .lean();

  const hasNext =
    products.length >
    pagination.limit;

  if (hasNext) {
    products.pop();
  }

  return {
    products,

    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      hasNext,
    },
  };
};

/*
|--------------------------------------------------------------------------
| UPDATE PRODUCT
|--------------------------------------------------------------------------
*/

const updateProduct = async (
  productId,
  updateData
) => {
  if (!isValidObjectId(productId)) {
    const error = new Error(
      "Invalid product ID"
    );

    error.statusCode = 400;

    throw error;
  }

  const existingProduct =
    await Product.findById(productId)
      .select(
        "_id slug categoryId isActive"
      )
      .lean();

  if (!existingProduct) {
    const error = new Error(
      "Product not found"
    );

    error.statusCode = 404;

    throw error;
  }

  const cleanData =
    cleanUpdateData(updateData);

  /*
   * Validate new category.
   */
  if (
    cleanData.categoryId &&
    cleanData.categoryId.toString() !==
      existingProduct.categoryId.toString()
  ) {
    await validateCategory(
      cleanData.categoryId
    );
  }

  /*
   * If pricing is being changed,
   * validate the complete pricing config.
   */
  if (
    cleanData.pricing ||
    cleanData.sizes ||
    cleanData.flavours
  ) {
    /*
     * Because pricing is interconnected,
     * fetch current product data when a partial
     * pricing update is received.
     */
    const currentProduct =
      await Product.findById(productId)
        .select(
          "pricing sizes flavours"
        )
        .lean();

    validatePricingConfiguration({
      pricing:
        cleanData.pricing ||
        currentProduct.pricing,

      sizes:
        cleanData.sizes ||
        currentProduct.sizes,

      flavours:
        cleanData.flavours ||
        currentProduct.flavours,
    });
  }

  /*
   * Validate new slug.
   */
  if (
    cleanData.slug &&
    cleanData.slug !==
      existingProduct.slug
  ) {
    const slugExists =
      await Product.findOne({
        slug: cleanData.slug,
        _id: {
          $ne: productId,
        },
      })
        .select("_id")
        .lean();

    if (slugExists) {
      const error = new Error(
        "A product with this slug already exists"
      );

      error.statusCode = 409;

      throw error;
    }
  }

  const updatedProduct =
    await Product.findByIdAndUpdate(
      productId,
      {
        $set: cleanData,
      },
      {
        new: true,
        runValidators: true,
      }
    ).lean();

  if (!updatedProduct) {
    const error = new Error(
      "Product update failed"
    );

    error.statusCode = 500;

    throw error;
  }

  /*
   * Invalidate old cache.
   */
  invalidateProductCaches({
    productId,
    slug: existingProduct.slug,
    categoryId:
      existingProduct.categoryId.toString(),
  });

  /*
   * Invalidate new cache.
   */
  invalidateProductCaches({
    productId,
    slug: updatedProduct.slug,
    categoryId:
      updatedProduct.categoryId.toString(),
  });

  return updatedProduct;
};

/*
|--------------------------------------------------------------------------
| DEACTIVATE PRODUCT
|--------------------------------------------------------------------------
*/

const deactivateProduct =
  async (productId) => {
    if (!isValidObjectId(productId)) {
      const error = new Error(
        "Invalid product ID"
      );

      error.statusCode = 400;

      throw error;
    }

    const product =
      await Product.findByIdAndUpdate(
        productId,
        {
          $set: {
            isActive: false,
          },
        },
        {
          new: true,
        }
      )
        .select(
          "_id name slug categoryId isActive"
        )
        .lean();

    if (!product) {
      const error = new Error(
        "Product not found"
      );

      error.statusCode = 404;

      throw error;
    }

    invalidateProductCaches({
      productId:
        product._id.toString(),

      slug: product.slug,

      categoryId:
        product.categoryId.toString(),
    });

    return product;
  };

/*
|--------------------------------------------------------------------------
| ACTIVATE PRODUCT
|--------------------------------------------------------------------------
*/

const activateProduct =
  async (productId) => {
    if (!isValidObjectId(productId)) {
      const error = new Error(
        "Invalid product ID"
      );

      error.statusCode = 400;

      throw error;
    }

    const product =
      await Product.findByIdAndUpdate(
        productId,
        {
          $set: {
            isActive: true,
          },
        },
        {
          new: true,
        }
      )
        .select(
          "_id name slug categoryId isActive"
        )
        .lean();

    if (!product) {
      const error = new Error(
        "Product not found"
      );

      error.statusCode = 404;

      throw error;
    }

    invalidateProductCaches({
      productId:
        product._id.toString(),

      slug: product.slug,

      categoryId:
        product.categoryId.toString(),
    });

    return product;
  };

const removeProduct = async (productId) => {
  if (!isValidObjectId(productId)) {
    const error = new Error("Invalid product ID"); error.statusCode = 400; throw error;
  }
  const product = await Product.findById(productId);
  if (!product) { const error = new Error("Product not found"); error.statusCode = 404; throw error; }
  for (const image of product.images || []) {
    if (image.publicId) await cloudinary.uploader.destroy(image.publicId, { resource_type: "image" });
  }
  await product.deleteOne();
  invalidateProductCaches({ productId: product._id.toString(), slug: product.slug, categoryId: product.categoryId.toString() });
};

module.exports = {
  createProduct,

  getCustomerProducts,
  getCustomerProductById,
  getCustomerProductBySlug,

  getAdminProducts,

  updateProduct,

  deactivateProduct,
  activateProduct,
  removeProduct,
};
