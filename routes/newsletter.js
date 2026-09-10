const express = require('express');
const router = express.Router();

const controller = require('../controllers/newsletterController');

router.post('/subscribe', controller.subscribe); // public

module.exports = router;
