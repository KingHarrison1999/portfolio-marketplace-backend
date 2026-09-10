const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/addressesController');

router.use(requireAuth);

router.get('/', controller.list);
router.post('/', controller.create);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
