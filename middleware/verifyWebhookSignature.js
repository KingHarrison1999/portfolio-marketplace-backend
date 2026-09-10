const crypto = require('crypto');

// FLAGGED: this is the generic HMAC-SHA256-over-the-raw-request-body
// pattern used by Stripe, GitHub, Shopify, and most other webhook
// providers -- NOT verified against Optimise Payments' actual signing
// method, since no public documentation for them could be found. Replace
// the header name and comparison logic here with their real scheme once
// it's known. Requires req.rawBody (see app.js's express.json verify
// callback) since the signature must be computed over the exact bytes
// received, not a re-serialized copy of the parsed JSON.
function verifyWebhookSignature(req, res, next) {
  const secret = process.env.OPTIMISE_PAYMENTS_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Webhook secret is not configured' });
  }

  const signature = req.headers['x-optimise-signature'];
  if (!signature || !req.rawBody) {
    return res.status(401).json({ error: 'Missing webhook signature' });
  }

  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  const isValid =
    signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}

module.exports = { verifyWebhookSignature };
