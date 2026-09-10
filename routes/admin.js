const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const commissionSettingsController = require('../controllers/commissionSettingsController');
const adSpacesController = require('../controllers/adSpacesController');
const adminDashboardController = require('../controllers/adminDashboardController');
const adminUsersController = require('../controllers/adminUsersController');
const listingsController = require('../controllers/listingsController');

// Everything in this router is admin-only -- unlike /api/listings, there's
// no seller carve-out here.
router.use(requireAuth, requireRole(['admin']));

router.get('/commission-settings', commissionSettingsController.get);
router.patch('/commission-settings', commissionSettingsController.update);

router.get('/ad-spaces', adSpacesController.list);
router.post('/ad-spaces', adSpacesController.create);
router.patch('/ad-spaces/:id', adSpacesController.update);
router.delete('/ad-spaces/:id', adSpacesController.remove);

router.get('/dashboard', adminDashboardController.get);

router.get('/users', adminUsersController.list);
router.get('/users/directory', adminUsersController.directory);
router.post('/users/:id/suspend', adminUsersController.suspend);
router.post('/users/:id/reactivate', adminUsersController.reactivate);
router.post('/users/:id/verify-commission-tier', adminUsersController.verifyCommissionTier);
router.patch('/users/:id/commission-tier', adminUsersController.overrideCommissionTier);

router.get('/listings', listingsController.listAllForAdmin);

module.exports = router;
