
const categoryService = require("./category.service");

/*
|--------------------------------------------------------------------------
| CREATE CATEGORY
|--------------------------------------------------------------------------
*/

const createCategory = async (req, res, next) => {
  try {
    const category = await categoryService.createCategory(
      req.body,
      req.file
    );

    return res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| GET ACTIVE CATEGORIES - CUSTOMER
|--------------------------------------------------------------------------
*/

const getActiveCategories = async (req, res, next) => {
  try {
    const categories =
      await categoryService.getActiveCategories();

    return res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| GET ALL CATEGORIES - ADMIN
|--------------------------------------------------------------------------
*/

const getAllCategories = async (req, res, next) => {
  try {
    const categories =
      await categoryService.getAllCategories();

    return res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| DEACTIVATE CATEGORY
|--------------------------------------------------------------------------
*/

const deactivateCategory = async (req, res, next) => {
  try {
    const category =
      await categoryService.deactivateCategory(
        req.params.id
      );

    return res.status(200).json({
      success: true,
      message: "Category deactivated successfully",
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| ACTIVATE CATEGORY
|--------------------------------------------------------------------------
*/

const activateCategory = async (req, res, next) => {
  try {
    const category =
      await categoryService.activateCategory(
        req.params.id
      );

    return res.status(200).json({
      success: true,
      message: "Category activated successfully",
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

const removeCategory = async (req, res, next) => {
  try {
    await categoryService.removeCategory(req.params.id);
    return res.status(200).json({ success: true, message: "Category removed successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCategory,
  getActiveCategories,
  getAllCategories,
  deactivateCategory,
  activateCategory,
  removeCategory,
};