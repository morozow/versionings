const { Router } = require('express');
const { validate } = require('../../shared/utils/validator');
const usersService = require('./users.service');

const router = Router();

const registerSchema = {
  email: { type: 'string', required: true },
  password: { type: 'string', required: true },
  name: { type: 'string', required: true }
};

const loginSchema = {
  email: { type: 'string', required: true },
  password: { type: 'string', required: true }
};

router.post('/register', (req, res, next) => {
  try {
    validate(registerSchema, req.body);
    const user = usersService.register(req.body);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

router.post('/login', (req, res, next) => {
  try {
    validate(loginSchema, req.body);
    const result = usersService.authenticate(req.body.email, req.body.password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const user = usersService.getProfile(req.params.id);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
