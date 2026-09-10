const express = require('express');
const router = express.Router();

const supabase = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const profileController = require('../controllers/profileController');

router.get('/', requireAuth, profileController.get);
router.patch('/', requireAuth, profileController.update);
router.delete('/', requireAuth, profileController.remove);

const VALID_COMMISSION_TIERS = ['individual', 'business', 'charity'];

router.post('/become-seller', requireAuth, requireRole(['buyer']), async (req, res) => {
  // express.json() leaves req.body undefined (not {}) for a request with no
  // body at all, e.g. a bodyless POST with no Content-Type -- destructuring
  // it directly would throw before the "omitted" case is even reached.
  const commissionTier = req.body?.commission_tier;
  if (commissionTier !== undefined && !VALID_COMMISSION_TIERS.includes(commissionTier)) {
    return res.status(400).json({ error: `commission_tier must be one of: ${VALID_COMMISSION_TIERS.join(', ')}` });
  }

  const updates = { role: 'seller' };
  if (commissionTier !== undefined) {
    // Self-declared at the moment of becoming a seller -- same "not
    // verified until an admin confirms it" rule as changing it later via
    // PATCH /api/profile (see profileService.js).
    updates.commission_tier = commissionTier;
    updates.commission_tier_verified = false;
  }

  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id);

  if (error) {
    return res.status(500).json({ error: 'Failed to upgrade role' });
  }

  res.json({ status: 'ok', role: 'seller', commission_tier: commissionTier ?? 'individual' });
});

module.exports = router;
