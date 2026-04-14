const { products } = require('./products.model');

function list(filters = {}) {
  let result = [...products];

  if (filters.category) {
    result = result.filter(p => p.category === filters.category);
  }
  if (filters.minPrice !== undefined) {
    result = result.filter(p => p.price >= Number(filters.minPrice));
  }
  if (filters.maxPrice !== undefined) {
    result = result.filter(p => p.price <= Number(filters.maxPrice));
  }

  return result;
}

function getById(id) {
  const product = products.find(p => p.id === id);
  if (!product) {
    throw Object.assign(new Error('Product not found'), { code: 'NOT_FOUND' });
  }
  return product;
}

function search(query) {
  if (!query || query.trim().length === 0) {
    return [];
  }
  const q = query.toLowerCase();
  return products.filter(
    p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
  );
}

function updateStock(id, delta) {
  const product = products.find(p => p.id === id);
  if (!product) {
    throw Object.assign(new Error('Product not found'), { code: 'NOT_FOUND' });
  }
  const newStock = product.stock + delta;
  if (newStock < 0) {
    throw Object.assign(new Error('Stock cannot be negative'), { code: 'STOCK_ERROR' });
  }
  product.stock = newStock;
  return product;
}

module.exports = { list, getById, search, updateStock };
