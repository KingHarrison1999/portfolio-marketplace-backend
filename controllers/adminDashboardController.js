const adminDashboardService = require('../services/adminDashboardService');

async function get(req, res) {
  const { data, error } = await adminDashboardService.getDashboard();
  if (error) {
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
  res.json(data);
}

module.exports = { get };
