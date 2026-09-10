const contactService = require('../services/contactService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function submit(req, res) {
  const name = (req.body?.name || '').trim();
  const email = (req.body?.email || '').trim();
  const message = (req.body?.message || '').trim();

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email, and message are required' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const result = await contactService.sendContactMessage({ name, email, message });
  if (!result.sent) {
    return res.status(502).json({ error: 'Failed to send your message. Please try again or email us directly.' });
  }

  res.status(201).json({ status: 'sent' });
}

module.exports = { submit };
