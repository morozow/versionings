const pkg = require('../../package.json');

async function healthPlugin(fastify) {
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      version: pkg.version,
      timestamp: new Date().toISOString()
    };
  });
}

module.exports = healthPlugin;
