const PRODUCT_CONSTANTS = {
  // Customer API pagination
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 50,

  // Cache duration
  CACHE_TTL: 5 * 60, // 5 minutes

  // Product limits
  MIN_NAME_LENGTH: 2,
  MAX_NAME_LENGTH: 150,

  MAX_DESCRIPTION_LENGTH: 2000,
  MAX_BADGE_LENGTH: 50,

  READY_NOW_CATEGORIES: ["cake", "benetto", "dessert", "pastries", "combos"],

  // Pricing
  MIN_PRICE: 0,

  // Product status
  STATUS: {
    ACTIVE: "active",
    INACTIVE: "inactive",
  },

  // Cache keys
  CACHE_KEYS: {
    ALL_PRODUCTS: "products:all",
    PRODUCT_BY_ID: "product:id",
    PRODUCT_BY_SLUG: "product:slug",
    PRODUCTS_BY_CATEGORY: "products:category",
  },
};

module.exports = PRODUCT_CONSTANTS;
