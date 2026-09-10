const profileService = require('../services/profileService');

async function get(req, res) {
  const { data, error } = await profileService.getProfile(req.user.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to load profile' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  // email/role come from the auth token + profiles row respectively, but
  // are read-only here -- role changes go through /become-seller (or
  // future admin action), never a generic profile PATCH, and email
  // changes go through Supabase Auth's own flow.
  res.json({ profile: { ...data, email: req.user.email } });
}

async function update(req, res) {
  if (req.body.commission_tier !== undefined && req.user.role !== 'seller') {
    return res.status(400).json({ error: 'Only sellers can set a commission tier' });
  }

  const { data, error } = await profileService.updateProfile(req.user.id, req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ profile: { ...data, email: req.user.email } });
}

async function remove(req, res) {
  const { count, error: countError } = await profileService.countSoldOrderItems(req.user.id);
  if (countError) {
    return res.status(500).json({ error: 'Failed to check account before deletion' });
  }
  if (count > 0) {
    return res.status(409).json({
      error: `Cannot delete account: you're the seller on ${count} order line item(s). Deleting your account would destroy the purchase record for buyers who bought from you.`,
    });
  }

  const { error } = await profileService.deleteAccount(req.user.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to delete account' });
  }
  res.status(204).send();
}

module.exports = { get, update, remove };
