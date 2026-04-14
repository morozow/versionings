function validate(schema, data) {
  if (!data || typeof data !== 'object') {
    throw Object.assign(new Error('Request body must be a JSON object'), {
      code: 'VALIDATION_ERROR'
    });
  }

  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`"${field}" is required`);
      continue;
    }

    if (value !== undefined && value !== null && rules.type) {
      if (rules.type === 'array' && !Array.isArray(value)) {
        errors.push(`"${field}" must be an array`);
      } else if (rules.type !== 'array' && typeof value !== rules.type) {
        errors.push(`"${field}" must be of type ${rules.type}`);
      }
    }
  }

  if (errors.length > 0) {
    throw Object.assign(new Error('Validation failed'), {
      code: 'VALIDATION_ERROR',
      details: errors
    });
  }
}

module.exports = { validate };
