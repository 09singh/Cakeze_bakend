const PRICE_INCREMENT_BY_COLLECTION = {
  everyday_favorite: 300,
  trending_collection: 400,
  signature_collection: 500,
};

function calculateProductPrice(product, weight, flavour) {
  const baseWeight = Number(product.pricing?.baseWeight) || 0.5;
  const basePrice = Number(flavour.basePrice);
  const increment = PRICE_INCREMENT_BY_COLLECTION[product.pricing?.collection];

  if (increment !== undefined) {
    return Math.round(basePrice + ((Number(weight) - baseWeight) / 0.5) * increment);
  }

  return basePrice * (Number(weight) / baseWeight);
}

module.exports = { PRICE_INCREMENT_BY_COLLECTION, calculateProductPrice };
