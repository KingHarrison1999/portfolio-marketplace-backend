const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

router.get('/open', (req, res) => {
  res.json({ message: 'This route is open to everyone.' });
});

router.get('/protected', requireAuth, (req, res) => {
  res.json({ message: 'You are logged in.', user: req.user });
});

router.get('/seller-only', requireAuth, requireRole(['seller', 'admin']), (req, res) => {
  res.json({ message: 'You are a seller or admin.', user: req.user });
});

module.exports = router;
