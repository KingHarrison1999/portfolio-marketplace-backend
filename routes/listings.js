const express = require('express');
const multer = require('multer');

const router = express.Router();

const { requireAuth, optionalAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const controller = require('../controllers/listingsController');

const sellerOnly = [requireAuth, requireRole(['seller', 'admin'])];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      const error = new Error('Only image files are allowed');
      error.status = 400;
      return cb(error);
    }
    cb(null, true);
  },
});

// Public routes. "/mine" and "/mine/dashboard" must be registered before
// the "/:id" wildcard or it would swallow them.
router.get('/', controller.browse);
router.get('/mine', ...sellerOnly, controller.getMine);
router.get('/mine/dashboard', ...sellerOnly, controller.getDashboard);
router.get('/:id', optionalAuth, controller.getPublic);

// Seller-only routes.
router.post('/', ...sellerOnly, controller.create);
router.patch('/:id', ...sellerOnly, controller.update);
router.delete('/:id', ...sellerOnly, controller.remove);
router.post('/:id/images', ...sellerOnly, upload.array('images', 10), controller.uploadImages);
router.delete('/:id/images/:imageId', ...sellerOnly, controller.deleteImage);

module.exports = router;
