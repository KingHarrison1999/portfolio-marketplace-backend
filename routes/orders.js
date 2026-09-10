const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/ordersController');

router.get('/mine', requireAuth, controller.getMine);
router.get('/by-group/:id', requireAuth, controller.getByGroup);

module.exports = router;
