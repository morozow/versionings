const { createOrder, STATUS_TRANSITIONS } = require('./orders.model');
const productsService = require('../products/products.service');

const orders = new Map();

function create(userId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('Order must contain at least one item'), { code: 'VALIDATION_ERROR' });
  }

  let total = 0;
  for (const item of items) {
    const product = productsService.getById(item.productId);
    if (product.stock < item.quantity) {
      throw Object.assign(
        new Error(`Insufficient stock for "${product.name}": available ${product.stock}, requested ${item.quantity}`),
        { code: 'STOCK_ERROR' }
      );
    }
    total += product.price * item.quantity;
  }

  for (const item of items) {
    productsService.updateStock(item.productId, -item.quantity);
  }

  const order = createOrder({ userId, items, total: Math.round(total * 100) / 100 });
  orders.set(order.id, order);
  return order;
}

function updateStatus(id, newStatus) {
  const order = orders.get(id);
  if (!order) {
    throw Object.assign(new Error('Order not found'), { code: 'NOT_FOUND' });
  }

  const allowed = STATUS_TRANSITIONS[order.status] || [];
  if (!allowed.includes(newStatus)) {
    throw Object.assign(
      new Error(`Cannot transition from "${order.status}" to "${newStatus}"`),
      { code: 'INVALID_TRANSITION' }
    );
  }

  order.status = newStatus;
  return order;
}

function getByUser(userId) {
  const result = [];
  for (const order of orders.values()) {
    if (order.userId === userId) {
      result.push(order);
    }
  }
  return result;
}

function getById(id) {
  const order = orders.get(id);
  if (!order) {
    throw Object.assign(new Error('Order not found'), { code: 'NOT_FOUND' });
  }
  return order;
}

module.exports = { create, updateStatus, getByUser, getById };
