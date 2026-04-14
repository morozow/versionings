const ERROR_STATUS_MAP = {
  VALIDATION_ERROR: 400,
  AUTH_ERROR: 401,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STOCK_ERROR: 422,
  INVALID_TRANSITION: 422
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const code = err.code || 'INTERNAL_ERROR';
  const status = ERROR_STATUS_MAP[code] || 500;
  const message = status === 500 ? 'Internal server error' : err.message;

  res.status(status).json({
    error: {
      code,
      message,
      details: status === 500 ? undefined : err.details
    }
  });
}

module.exports = errorHandler;
