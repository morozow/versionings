const { createUser } = require('./users.model');

const users = new Map();

function hashPassword(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    hash = ((hash << 5) - hash + password.charCodeAt(i)) | 0;
  }
  return 'hashed_' + Math.abs(hash).toString(16);
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function register(data) {
  if (!data.email || !isValidEmail(data.email)) {
    throw Object.assign(new Error('Invalid email address'), { code: 'VALIDATION_ERROR' });
  }
  if (!data.password || data.password.length < 6) {
    throw Object.assign(new Error('Password must be at least 6 characters'), { code: 'VALIDATION_ERROR' });
  }
  if (!data.name || data.name.trim().length === 0) {
    throw Object.assign(new Error('Name is required'), { code: 'VALIDATION_ERROR' });
  }

  for (const user of users.values()) {
    if (user.email === data.email) {
      throw Object.assign(new Error('Email already registered'), { code: 'CONFLICT' });
    }
  }

  const user = createUser({
    email: data.email,
    name: data.name.trim(),
    role: data.role || 'user',
    passwordHash: hashPassword(data.password)
  });

  users.set(user.id, user);

  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

function authenticate(email, password) {
  for (const user of users.values()) {
    if (user.email === email && user.passwordHash === hashPassword(password)) {
      return { userId: user.id, token: 'tok_' + user.id + '_' + Date.now() };
    }
  }
  throw Object.assign(new Error('Invalid credentials'), { code: 'AUTH_ERROR' });
}

function getProfile(id) {
  const user = users.get(id);
  if (!user) {
    throw Object.assign(new Error('User not found'), { code: 'NOT_FOUND' });
  }
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

module.exports = { register, authenticate, getProfile };
