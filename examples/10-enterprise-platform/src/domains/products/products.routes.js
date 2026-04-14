const { Router } = require('express');
const productsService = require('./products.service');

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const filters = {
      category: req.query.category,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice
    };
    const products = productsService.list(filters);
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.get('/search', (req, res, next) => {
  try {
    const results = productsService.search(req.query.q);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const product = productsService.getById(req.params.id);
    res.json(product);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
