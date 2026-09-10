const adminUsersService = require('../services/adminUsersService');

async function list(req, res) {
  const search = (req.query.search || '').trim();
  const { data, error } = await adminUsersService.searchUsers(search);
  if (error) {
    return res.status(500).json({ error: 'Failed to load users' });
  }
  res.json({ users: data });
}

async function directory(req, res) {
  const { data, error } = await adminUsersService.getAllUsersDirectory();
  if (error) {
    return res.status(500).json({ error: 'Failed to load users' });
  }
  res.json({ users: data });
}

async function suspend(req, res) {
  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: 'You cannot suspend your own account' });
  }

  const { data, error } = await adminUsersService.suspendUser(req.params.id);
  if (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Failed to suspend user' });
  }
  res.json({ user: { id: data.user.id, email: data.user.email, banned_until: data.user.banned_until } });
}

async function reactivate(req, res) {
  const { data, error } = await adminUsersService.reactivateUser(req.params.id);
  if (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Failed to reactivate user' });
  }
  res.json({ user: { id: data.user.id, email: data.user.email, banned_until: data.user.banned_until } });
}

async function verifyCommissionTier(req, res) {
  const { data, error } = await adminUsersService.verifyCommissionTier(req.params.id);
  if (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Failed to verify commission tier' });
  }
  res.json({ profile: data });
}

async function overrideCommissionTier(req, res) {
  const { data, error } = await adminUsersService.overrideCommissionTier(req.params.id, req.body.commission_tier);
  if (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Failed to update commission tier' });
  }
  res.json({ profile: data });
}

module.exports = { list, directory, suspend, reactivate, verifyCommissionTier, overrideCommissionTier };
