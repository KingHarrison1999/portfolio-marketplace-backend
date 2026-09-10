const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/cartController');

router.use(requireAuth);

router.get('/', controller.getCart);
router.post('/items', controller.addItem);
router.patch('/items/:id', controller.updateItem);
router.delete('/items/:id', controller.removeItem);

module.exports = router;
