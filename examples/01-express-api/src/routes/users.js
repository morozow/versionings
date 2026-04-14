const { Router } = require('express');

const router = Router();

const users = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'admin' },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'editor' },
  { id: 3, name: 'Charlie Brown', email: 'charlie@example.com', role: 'viewer' },
  { id: 4, name: 'Diana Prince', email: 'diana@example.com', role: 'editor' }
];

router.get('/', (req, res) => {
  res.json(users);
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);

  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  const user = users.find((u) => u.id === id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(user);
});

module.exports = router;
