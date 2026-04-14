function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authorization header is required' }
    });
  }

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid authorization format. Use: Bearer <token>' }
    });
  }

  const token = parts[1];
  const match = token.match(/^tok_(\d+)_\d+$/);
  if (!match) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' }
    });
  }

  req.userId = match[1];
  next();
}

module.exports = authMiddleware;
