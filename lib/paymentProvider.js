// Optimise Payments integration.
//
// FLAGGED: "Optimise Payments" is not a findable, publicly documented
// payment processor -- checked via web search; no docs site, API
// reference, or company presence turned up. Everything provider-specific
// in this file and in middleware/verifyWebhookSignature.js -- the hosted
// checkout session request/response shape, the webhook payload shape, and
// the signature scheme -- is INVENTED, based on the pattern shared by
// real providers (Stripe, Square, Adyen, etc.): a session with an amount/
// currency/reference, a redirect URL, and a webhook signed with
// HMAC-SHA256 over the raw body using a shared secret. None of it is
// verified against a real spec.
//
// createPayment/refundPayment below are a local simulation, not a real
// HTTP integration -- there's no real endpoint to call (OPTIMISE_PAYMENTS_
// API_KEY has never had a real value). They let the rest of the system --
// checkout-group linkage, webhook handling, stock re-validation, order
// state transitions -- be built and genuinely tested now, with the
// provider-specific parts isolated to this file. Before this goes near
// real money, swap these three functions (and the signature check in
// verifyWebhookSignature.js) for Optimise's real API once real docs or
// sandbox credentials exist -- nothing else in the codebase should need
// to change, since callers only depend on this module's interface.

const crypto = require('crypto');

async function createPayment({ amount, currency, reference }) {
  const sessionId = `sim_${crypto.randomUUID()}`;
  return {
    session_id: sessionId,
    redirect_url: `https://pay.optimise-payments-sandbox.invalid/session/${sessionId}`,
    amount,
    currency,
    reference,
    status: 'pending',
  };
}

async function getPaymentStatus() {
  throw new Error('paymentProvider.getPaymentStatus is not implemented -- no real Optimise Payments API to call yet');
}

// Simulated: a real integration would call Optimise's refund endpoint and
// return their response. This just reports success so the all-or-nothing
// fail/refund path can be exercised end-to-end without a real provider.
async function refundPayment(paymentId, { amount } = {}) {
  return { refund_id: `sim_refund_${crypto.randomUUID()}`, payment_id: paymentId, amount, status: 'refunded' };
}

module.exports = {
  createPayment,
  getPaymentStatus,
  refundPayment,
};
