const { Router } = require('express');
const { validate } = require('../../shared/utils/validator');
const ordersService = require('./orders.service');

const router = Router();

const createOrderSchema = {
  items: { type: 'array', required: true }
};

const updateStatusSchema = {
  status: { type: 'string', required: true }
};

router.post('/', (req, res, next) => {
  try {
    validate(createOrderSchema, req.body);
    const order = ordersService.create(req.userId, req.body.items);
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const order = ordersService.getById(req.params.id);
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', (req, res, next) => {
  try {
    validate(updateStatusSchema, req.body);
    const order = ordersService.updateStatus(req.params.id, req.body.status);
    res.json(order);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
