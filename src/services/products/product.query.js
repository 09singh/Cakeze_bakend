const PRODUCT_CONSTANTS = require("./product.constants");

/*
|--------------------------------------------------------------------------
| CUSTOMER PRODUCT LIST
|--------------------------------------------------------------------------
*/

const CUSTOMER_PRODUCT_PROJECTION = {
  name: 1,
  slug: 1,
  categoryId: 1,
  images: 1,
  sizes: 1,
  flavours: 1,
  pricing: 1,
  badge: 1,
  sortOrder: 1,
  inventoryQuantity: 1,
};

/*
|--------------------------------------------------------------------------
| CUSTOMER PRODUCT DETAIL
|--------------------------------------------------------------------------
*/

const CUSTOMER_PRODUCT_DETAIL_PROJECTION = {
  name: 1,
  slug: 1,
  description: 1,
  categoryId: 1,
  images: 1,
  sizes: 1,
  flavours: 1,
  pricing: 1,
  badge: 1,
  inventoryQuantity: 1,
};

/*
|--------------------------------------------------------------------------
| ADMIN PRODUCT
|--------------------------------------------------------------------------
*/

const ADMIN_PRODUCT_PROJECTION = {
  name: 1,
  slug: 1,
  description: 1,
  categoryId: 1,
  images: 1,
  sizes: 1,
  flavours: 1,
  pricing: 1,
  badge: 1,
  isActive: 1,
  inventoryQuantity: 1,
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 1,
};

/*
|--------------------------------------------------------------------------
| CUSTOMER FILTER
|--------------------------------------------------------------------------
*/

const buildCustomerFilter = ({
  categoryId,
  search,
}) => {
  const filter = {
    isActive: true,
    inventoryQuantity: { $gt: 0 },
  };

  if (categoryId) {
    filter.categoryId = categoryId;
  }

  if (search) {
    filter.$or = [
      {
        name: {
          $regex: search,
          $options: "i",
        },
      },
      {
        description: {
          $regex: search,
          $options: "i",
        },
      },
    ];
  }

  return filter;
};

/*
|--------------------------------------------------------------------------
| ADMIN FILTER
|--------------------------------------------------------------------------
*/

const buildAdminFilter = ({
  categoryId,
  isActive,
  search,
}) => {
  const filter = {};

  if (categoryId) {
    filter.categoryId = categoryId;
  }

  if (typeof isActive === "boolean") {
    filter.isActive = isActive;
  }

  if (search) {
    filter.name = {
      $regex: search,
      $options: "i",
    };
  }

  return filter;
};

/*
|--------------------------------------------------------------------------
| PAGINATION
|--------------------------------------------------------------------------
*/

const buildPagination = ({
  page = PRODUCT_CONSTANTS.DEFAULT_PAGE,
  limit = PRODUCT_CONSTANTS.DEFAULT_LIMIT,
}) => {
  const safePage = Math.max(
    1,
    Number(page)
  );

  const safeLimit = Math.min(
    Math.max(1, Number(limit)),
    PRODUCT_CONSTANTS.MAX_LIMIT
  );

  const skip =
    (safePage - 1) * safeLimit;

  return {
    page: safePage,
    limit: safeLimit,
    skip,
  };
};

/*
|--------------------------------------------------------------------------
| SORT
|--------------------------------------------------------------------------
*/

const buildSort = (
  sort = "sort_order"
) => {
  switch (sort) {
    case "newest":
      return {
        createdAt: -1,
      };

    case "oldest":
      return {
        createdAt: 1,
      };

    case "sort_order":
    default:
      return {
        sortOrder: 1,
        createdAt: -1,
      };
  }
};

module.exports = {
  CUSTOMER_PRODUCT_PROJECTION,
  CUSTOMER_PRODUCT_DETAIL_PROJECTION,
  ADMIN_PRODUCT_PROJECTION,

  buildCustomerFilter,
  buildAdminFilter,

  buildPagination,
  buildSort,
};
