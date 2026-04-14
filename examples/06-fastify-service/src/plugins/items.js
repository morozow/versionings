const { itemSchema } = require('../schemas/item.schema');

async function itemsPlugin(fastify) {
  const items = new Map();
  let nextId = 1;

  fastify.get('/items', async () => {
    return Array.from(items.values());
  });

  fastify.post('/items', {
    schema: {
      body: itemSchema
    }
  }, async (request, reply) => {
    const id = String(nextId++);
    const item = { id, ...request.body };
    items.set(id, item);
    reply.code(201);
    return item;
  });

  fastify.put('/items/:id', {
    schema: {
      body: itemSchema
    }
  }, async (request, reply) => {
    const { id } = request.params;
    if (!items.has(id)) {
      reply.code(404);
      return { error: 'Item not found' };
    }
    const item = { id, ...request.body };
    items.set(id, item);
    return item;
  });

  fastify.delete('/items/:id', async (request, reply) => {
    const { id } = request.params;
    if (!items.has(id)) {
      reply.code(404);
      return { error: 'Item not found' };
    }
    items.delete(id);
    reply.code(204);
    return '';
  });
}

module.exports = itemsPlugin;
