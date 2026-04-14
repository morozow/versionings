const fastify = require('fastify')({ logger: true });
const healthPlugin = require('./plugins/health');
const itemsPlugin = require('./plugins/items');

fastify.register(healthPlugin);
fastify.register(itemsPlugin);

const port = process.env.PORT || 3000;

fastify.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});

module.exports = fastify;
