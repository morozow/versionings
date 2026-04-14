const ORDER_STATUSES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered'
};

const STATUS_TRANSITIONS = {
  [ORDER_STATUSES.PENDING]: [ORDER_STATUSES.CONFIRMED],
  [ORDER_STATUSES.CONFIRMED]: [ORDER_STATUSES.SHIPPED],
  [ORDER_STATUSES.SHIPPED]: [ORDER_STATUSES.DELIVERED],
  [ORDER_STATUSES.DELIVERED]: []
};

let nextId = 1;

function createOrder(data) {
  return {
    id: String(nextId++),
    userId: data.userId,
    items: data.items,
    total: data.total,
    status: ORDER_STATUSES.PENDING,
    createdAt: new Date().toISOString()
  };
}

module.exports = { ORDER_STATUSES, STATUS_TRANSITIONS, createOrder };
