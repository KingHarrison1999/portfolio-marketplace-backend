const paymentWebhookService = require('../services/paymentWebhookService');

async function handleOptimisePaymentsWebhook(req, res) {
  const { event, data } = req.body || {};

  if (!event || !data || !data.reference) {
    return res.status(400).json({ error: 'Malformed webhook payload' });
  }

  const checkoutGroupId = data.reference;

  if (event === 'payment.succeeded') {
    const { data: result, error } = await paymentWebhookService.handlePaymentSucceeded(
      checkoutGroupId,
      data.session_id,
      data.amount,
    );
    if (error) {
      return res.status(500).json({ error: 'Failed to process payment confirmation' });
    }
    return res.status(200).json({ received: true, ...result });
  }

  if (event === 'payment.failed') {
    const { data: result, error } = await paymentWebhookService.handlePaymentFailed(checkoutGroupId);
    if (error) {
      return res.status(500).json({ error: 'Failed to process payment failure' });
    }
    return res.status(200).json({ received: true, ...result });
  }

  // Unknown event type -- acknowledge with 200 so the provider doesn't
  // retry forever, but don't act on it. Standard webhook practice: ack
  // quickly once the signature is valid, regardless of whether the event
  // is one we recognize.
  res.status(200).json({ received: true, result: 'ignored_unknown_event' });
}

module.exports = { handleOptimisePaymentsWebhook };
