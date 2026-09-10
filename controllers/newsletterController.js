const newsletterService = require('../services/newsletterService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function subscribe(req, res) {
  const email = (req.body?.email || '').trim();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const { error } = await newsletterService.subscribe(email);
  if (error) {
    // Unique violation -- already subscribed. Idempotent success, not an
    // error a real visitor needs to see or understand.
    if (error.code === '23505') {
      return res.status(200).json({ status: 'already_subscribed' });
    }
    return res.status(500).json({ error: 'Failed to subscribe' });
  }

  res.status(201).json({ status: 'subscribed' });
}

module.exports = { subscribe };
