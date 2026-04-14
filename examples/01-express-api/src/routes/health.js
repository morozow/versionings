const { Router } = require('express');
const pkg = require('../../package.json');

const router = Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    version: pkg.version,
    uptime: Math.floor(process.uptime())
  });
});

module.exports = router;
