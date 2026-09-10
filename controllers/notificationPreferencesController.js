const notificationPreferencesService = require('../services/notificationPreferencesService');

async function get(req, res) {
  const { data, error } = await notificationPreferencesService.getOrCreatePreferences(req.user.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to load notification preferences' });
  }
  res.json({ notification_preferences: data });
}

async function update(req, res) {
  const { email_order_updates: emailOrderUpdates, email_marketing: emailMarketing } = req.body;
  if (emailOrderUpdates !== undefined && typeof emailOrderUpdates !== 'boolean') {
    return res.status(400).json({ error: 'email_order_updates must be a boolean' });
  }
  if (emailMarketing !== undefined && typeof emailMarketing !== 'boolean') {
    return res.status(400).json({ error: 'email_marketing must be a boolean' });
  }

  const { data, error } = await notificationPreferencesService.updatePreferences(req.user.id, req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ notification_preferences: data });
}

module.exports = { get, update };
