const listingsService = require('../services/listingsService');
const listingImagesService = require('../services/listingImagesService');

async function assertOwnedListing(req, res) {
  const { data: listing, error } = await listingsService.getListingById(req.params.id);

  if (error) {
    res.status(500).json({ error: 'Failed to load listing' });
    return null;
  }
  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return null;
  }
  if (listing.seller_id !== req.user.id && req.user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return listing;
}

// category_id can be repeated (?category_id=a&category_id=b) to filter by
// multiple categories at once; a single occurrence still works as before.
function parseCategoryIds(value) {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const ids = values.filter((v) => typeof v === 'string' && v.length > 0);
  return ids.length > 0 ? ids : undefined;
}

async function browse(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const minPrice = req.query.min_price !== undefined ? Number(req.query.min_price) : undefined;
  const maxPrice = req.query.max_price !== undefined ? Number(req.query.max_price) : undefined;

  const { data, error, count } = await listingsService.searchListings({
    categoryIds: parseCategoryIds(req.query.category_id),
    minPrice: Number.isFinite(minPrice) ? minPrice : undefined,
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : undefined,
    q: req.query.q,
    sort: req.query.sort,
    page,
    limit,
  });

  if (error) {
    return res.status(500).json({ error: 'Failed to search listings' });
  }

  res.json({ listings: data, total: count, page, limit });
}

async function getPublic(req, res) {
  const { data: listing, error } = await listingsService.getListingById(req.params.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to load listing' });
  }
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found' });
  }

  if (listing.status === 'active') {
    return res.json({ listing });
  }

  if (req.user && (req.user.id === listing.seller_id || req.user.role === 'admin')) {
    return res.json({ listing });
  }

  // Don't distinguish "exists but isn't yours" from "doesn't exist" for a
  // public-facing endpoint.
  return res.status(404).json({ error: 'Listing not found' });
}

async function create(req, res) {
  const { title, price, stock } = req.body;
  if (!title || price === undefined || stock === undefined) {
    return res.status(400).json({ error: 'title, price, and stock are required' });
  }

  const { data, error } = await listingsService.createListing(req.user.id, req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ listing: data });
}

async function getMine(req, res) {
  const { data, error } = await listingsService.getListingsBySeller(req.user.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to load listings' });
  }
  res.json({ listings: data });
}

async function getDashboard(req, res) {
  const { data, error } = await listingsService.getSellerDashboard(req.user.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
  res.json(data);
}

async function update(req, res) {
  const listing = await assertOwnedListing(req, res);
  if (!listing) return;

  // title is NOT NULL at the DB level, but an empty string satisfies that
  // -- with no CHECK constraint requiring non-blank content, PATCH would
  // otherwise silently accept title: '' and blank out the listing.
  if (req.body.title !== undefined && !req.body.title) {
    return res.status(400).json({ error: 'title cannot be empty' });
  }

  const { data, error } = await listingsService.updateListing(listing.id, req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ listing: data });
}

async function remove(req, res) {
  const listing = await assertOwnedListing(req, res);
  if (!listing) return;

  const { data, error } = await listingsService.softDeleteListing(listing.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to remove listing' });
  }
  res.json({ listing: data });
}

async function uploadImages(req, res) {
  const listing = await assertOwnedListing(req, res);
  if (!listing) return;

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No image files provided' });
  }

  const { data, error } = await listingImagesService.uploadImages(listing.id, req.files);
  if (error) {
    return res.status(500).json({ error: 'Failed to upload images' });
  }

  res.status(201).json({ images: data });
}

async function deleteImage(req, res) {
  const listing = await assertOwnedListing(req, res);
  if (!listing) return;

  const { error, notFound } = await listingImagesService.deleteImage(listing.id, req.params.imageId);
  if (notFound) {
    return res.status(404).json({ error: 'Image not found' });
  }
  if (error) {
    return res.status(500).json({ error: 'Failed to delete image' });
  }
  res.status(204).send();
}

// Admin-only -- GET /api/admin/listings. Every listing, every status, every
// seller (searchListings/browse always filters to status='active').
async function listAllForAdmin(req, res) {
  const { data, error } = await listingsService.getAllListingsForAdmin();
  if (error) {
    return res.status(500).json({ error: 'Failed to load listings' });
  }
  res.json({ listings: data });
}

module.exports = {
  browse,
  getPublic,
  create,
  getMine,
  getDashboard,
  update,
  remove,
  uploadImages,
  deleteImage,
  listAllForAdmin,
};
