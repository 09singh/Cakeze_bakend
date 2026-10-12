const productService = require("./product.service");


/*
|--------------------------------------------------------------------------
| CREATE PRODUCT
|--------------------------------------------------------------------------
*/
const createProduct = async (req, res, next) => {
  try {
    console.log("BODY RECEIVED:", req.body);
    console.log("FILES RECEIVED:", req.files?.length || 0);

    let productData;

    if (typeof req.body.product === "string") {
      try {
        productData = JSON.parse(req.body.product);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "Invalid product JSON data",
        });
      }
    } else {
      productData = req.body;
    }

    console.log("PARSED PRODUCT DATA:", productData);
    console.log("CATEGORY ID:", productData.categoryId);

    const product = await productService.createProduct(
      productData,
      req.files || []
    );

    console.log("SAVED PRODUCT:", product._id);

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    console.error("CREATE PRODUCT ERROR:", error);
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| CUSTOMER - GET PRODUCTS
|--------------------------------------------------------------------------
*/

const getCustomerProducts = async (req, res, next) => {
  try {
    const result =
      await productService.getCustomerProducts(
        req.query
      );

    return res.status(200).json({
      success: true,
      data: result.products,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| CUSTOMER - GET PRODUCT BY ID
|--------------------------------------------------------------------------
*/

const getCustomerProductById = async (
  req,
  res,
  next
) => {
  try {
    const product =
      await productService.getCustomerProductById(
        req.params.id
      );

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| CUSTOMER - GET PRODUCT BY SLUG
|--------------------------------------------------------------------------
*/

const getCustomerProductBySlug = async (
  req,
  res,
  next
) => {
  try {
    const product =
      await productService.getCustomerProductBySlug(
        req.params.slug
      );

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| ADMIN - GET PRODUCTS
|--------------------------------------------------------------------------
*/

const getAdminProducts = async (
  req,
  res,
  next
) => {
  try {
    const result =
      await productService.getAdminProducts(
        req.query
      );

    return res.status(200).json({
      success: true,
      data: result.products,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| ADMIN - UPDATE PRODUCT
|--------------------------------------------------------------------------
*/

const updateProduct = async (
  req,
  res,
  next
) => {
  try {
    const product =
      await productService.updateProduct(
        req.params.id,
        req.body
      );

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| ADMIN - DEACTIVATE PRODUCT
|--------------------------------------------------------------------------
*/

const deactivateProduct = async (
  req,
  res,
  next
) => {
  try {
    const product =
      await productService.deactivateProduct(
        req.params.id
      );

    return res.status(200).json({
      success: true,
      message: "Product deactivated successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| ADMIN - ACTIVATE PRODUCT
|--------------------------------------------------------------------------
*/

const activateProduct = async (
  req,
  res,
  next
) => {
  try {
    const product =
      await productService.activateProduct(
        req.params.id
      );

    return res.status(200).json({
      success: true,
      message: "Product activated successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

const removeProduct = async (req, res, next) => {
  try {
    await productService.removeProduct(req.params.id);
    return res.status(200).json({ success: true, message: "Product removed successfully" });
  } catch (error) {
    next(error);
  }
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