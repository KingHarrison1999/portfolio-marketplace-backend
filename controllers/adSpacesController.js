const adSpacesService = require('../services/adSpacesService');

async function assertAdSpaceExists(req, res) {
  const { data: adSpace, error } = await adSpacesService.getAdSpaceById(req.params.id);
  if (error) {
    res.status(500).json({ error: 'Failed to load ad space' });
    return null;
  }
  if (!adSpace) {
    res.status(404).json({ error: 'Ad space not found' });
    return null;
  }
  return adSpace;
}

async function list(req, res) {
  const { data, error } = await adSpacesService.getAllAdSpaces();
  if (error) {
    return res.status(500).json({ error: 'Failed to load ad spaces' });
  }
  res.json({ ad_spaces: data });
}

async function create(req, res) {
  // business_name is intentionally optional -- a house/no-owner promo
  // (e.g. a raffle) isn't a business and shouldn't need a placeholder name.
  const { placement, start_date: startDate } = req.body;
  if (!placement || !startDate) {
    return res.status(400).json({ error: 'placement and start_date are required' });
  }

  const { data, error } = await adSpacesService.createAdSpace(req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json({ ad_space: data });
}

async function update(req, res) {
  const adSpace = await assertAdSpaceExists(req, res);
  if (!adSpace) return;

  const { data, error } = await adSpacesService.updateAdSpace(adSpace.id, req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ ad_space: data });
}

// Soft-deactivate (is_active = false), same convention as listings'
// DELETE -- never a hard row delete.
async function remove(req, res) {
  const adSpace = await assertAdSpaceExists(req, res);
  if (!adSpace) return;

  const { data, error } = await adSpacesService.deactivateAdSpace(adSpace.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to deactivate ad space' });
  }
  res.json({ ad_space: data });
}

// Public -- GET /api/ad-spaces?placement=X. No auth: this is what the site
// itself calls to render ads, same trust level as GET /api/listings.
async function listActive(req, res) {
  const placement = (req.query.placement || '').trim();
  if (!placement) {
    return res.status(400).json({ error: 'placement query param is required' });
  }

  const { data, error } = await adSpacesService.getActiveAdSpacesForPlacement(placement);
  if (error) {
    return res.status(500).json({ error: 'Failed to load ad spaces' });
  }
  res.json({ ad_spaces: data });
}

module.exports = { list, create, update, remove, listActive };
