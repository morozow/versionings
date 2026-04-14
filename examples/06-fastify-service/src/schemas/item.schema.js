const itemSchema = {
  type: 'object',
  required: ['name', 'description', 'price'],
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    price: { type: 'number', minimum: 0 }
  },
  additionalProperties: false
};

module.exports = { itemSchema };
