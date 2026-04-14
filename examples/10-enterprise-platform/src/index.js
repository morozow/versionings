const express = require('express');
const authMiddleware = require('./shared/middleware/auth');
const errorHandler = require('./shared/middleware/error-handler');
const usersRoutes = require('./domains/users/users.routes');
const ordersRoutes = require('./domains/orders/orders.routes');
const productsRoutes = require('./domains/products/products.routes');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  const pkg = require('../package.json');
  res.json({ status: 'ok', version: pkg.version, uptime: process.uptime() });
});

app.use('/products', productsRoutes);

app.use('/users', usersRoutes);
app.use('/orders', authMiddleware, ordersRoutes);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Enterprise Platform running on port ${port}`);
});

module.exports = app;
