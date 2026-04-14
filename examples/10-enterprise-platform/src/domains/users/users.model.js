let nextId = 1;

function createUser(data) {
  return {
    id: String(nextId++),
    email: data.email,
    name: data.name,
    role: data.role || 'user',
    passwordHash: data.passwordHash,
    createdAt: new Date().toISOString()
  };
}

module.exports = { createUser };
