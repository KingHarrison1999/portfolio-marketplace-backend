const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/notificationPreferencesController');

router.get('/', requireAuth, controller.get);
router.patch('/', requireAuth, controller.update);

module.exports = router;
