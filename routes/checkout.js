const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/checkoutController');

router.post('/', requireAuth, controller.checkout);
router.post('/pay', requireAuth, controller.pay);
router.get('/session-status', requireAuth, controller.sessionStatus);

module.exports = router;
