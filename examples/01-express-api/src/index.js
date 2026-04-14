const express = require('express');
const logger = require('./middleware/logger');
const healthRoutes = require('./routes/health');
const usersRoutes = require('./routes/users');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(logger);

app.use('/health', healthRoutes);
app.use('/users', usersRoutes);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;
