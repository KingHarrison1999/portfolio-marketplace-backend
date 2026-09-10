const express = require('express');
const router = express.Router();

const { verifyWebhookSignature } = require('../middleware/verifyWebhookSignature');
const controller = require('../controllers/webhooksController');

router.post('/optimise-payments', verifyWebhookSignature, controller.handleOptimisePaymentsWebhook);

module.exports = router;
