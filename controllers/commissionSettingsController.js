const commissionSettingsService = require('../services/commissionSettingsService');

async function get(req, res) {
  const { data, error } = await commissionSettingsService.getSettings();
  if (error) {
    return res.status(500).json({ error: 'Failed to load commission settings' });
  }
  res.json({ commission_settings: data });
}

// flat_rate is the individual/default tier and stays required, matching
// its existing behavior. business_rate/charity_rate are optional per-field
// (PATCH semantics) -- there's no default to fall back to for either yet
// (see the migration), so a caller updating only flat_rate doesn't have to
// also supply values for tiers that haven't been decided yet.
function validateRate(name, value) {
  if (typeof value !== 'number' || value < 0 || value > 1) {
    return `${name} must be a number between 0 and 1`;
  }
  return null;
}

async function update(req, res) {
  const { flat_rate: flatRate, business_rate: businessRate, charity_rate: charityRate } = req.body;

  if (flatRate === undefined) {
    return res.status(400).json({ error: 'flat_rate is required' });
  }

  const updates = {};
  for (const [name, value] of [
    ['flat_rate', flatRate],
    ['business_rate', businessRate],
    ['charity_rate', charityRate],
  ]) {
    if (value === undefined) continue;
    const error = validateRate(name, value);
    if (error) {
      return res.status(400).json({ error });
    }
    updates[name] = value;
  }

  const { data, error } = await commissionSettingsService.updateSettings(updates);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ commission_settings: data });
}

module.exports = { get, update };
