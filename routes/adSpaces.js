const express = require('express');
const router = express.Router();

const controller = require('../controllers/adSpacesController');

// Public -- distinct from the admin-only CRUD at /api/admin/ad-spaces.
router.get('/', controller.listActive); // ?placement=X

module.exports = router;
