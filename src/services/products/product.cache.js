const PRODUCT_CONSTANTS = require("./product.constants");

/*
 * Simple in-memory cache.
 *
 * Current scale:
 * - Low traffic
 * - Small product catalog
 * - Single backend instance
 *
 * Later this can be replaced with Redis
 * without changing controller/service logic.
 */

const cache = new Map();

/*
 * Create a unique cache key.
 *
 * Example:
 * products:list:page=1:limit=20:category=123
 */
const createCacheKey = (prefix, params = {}) => {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return sortedParams
    ? `${prefix}:${sortedParams}`
    : prefix;
};

/*
 * Store data in cache.
 */
const setCache = (
  key,
  data,
  ttl = PRODUCT_CONSTANTS.CACHE_TTL
) => {
  const expiresAt = Date.now() + ttl * 1000;

  cache.set(key, {
    data,
    expiresAt,
  });
};

/*
 * Get data from cache.
 */
const getCache = (key) => {
  const cached = cache.get(key);

  if (!cached) {
    return null;
  }

  /*
   * Remove expired cache automatically.
   */
  if (Date.now() > cached.expiresAt) {
    cache.delete(key);
    return null;
  }

  return cached.data;
};

/*
 * Delete one cache entry.
 */
const deleteCache = (key) => {
  cache.delete(key);
};

/*
 * Delete all cache entries belonging
 * to a specific prefix.
 *
 * Example:
 * invalidateByPrefix("products:list")
 */
const invalidateByPrefix = (prefix) => {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
};

/*
 * Clear the entire product cache.
 *
 * Useful after operations that can affect
 * multiple product-related cached responses.
 */
const clearProductCache = () => {
  cache.clear();
};

/*
 * Product-specific helpers.
 */

const getProductListCacheKey = (params = {}) => {
  return createCacheKey(
    PRODUCT_CONSTANTS.CACHE_KEYS.ALL_PRODUCTS,
    params
  );
};

const getProductByIdCacheKey = (id) => {
  return `${PRODUCT_CONSTANTS.CACHE_KEYS.PRODUCT_BY_ID}:${id}`;
};

const getProductBySlugCacheKey = (slug) => {
  return `${PRODUCT_CONSTANTS.CACHE_KEYS.PRODUCT_BY_SLUG}:${slug}`;
};

const getProductsByCategoryCacheKey = (
  categoryId,
  params = {}
) => {
  return createCacheKey(
    `${PRODUCT_CONSTANTS.CACHE_KEYS.PRODUCTS_BY_CATEGORY}:${categoryId}`,
    params
  );
};

module.exports = {
  createCacheKey,

  setCache,
  getCache,
  deleteCache,

  invalidateByPrefix,
  clearProductCache,

  getProductListCacheKey,
  getProductByIdCacheKey,
  getProductBySlugCacheKey,
  getProductsByCategoryCacheKey,
};