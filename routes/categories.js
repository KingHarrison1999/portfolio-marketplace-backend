const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const controller = require('../controllers/categoriesController');

const adminOnly = [requireAuth, requireRole(['admin'])];

router.get('/', controller.list); // public -- buyers need this for browse filters
router.post('/', ...adminOnly, controller.create);
router.patch('/:id', ...adminOnly, controller.update);
router.delete('/:id', ...adminOnly, controller.remove);

module.exports = router;
