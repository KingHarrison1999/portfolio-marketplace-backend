const Stripe = require('stripe');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error('Missing STRIPE_SECRET_KEY environment variable');
}

// This is a portfolio demo -- refuse to run with anything but a Stripe test
// key, so it's never possible to accidentally take a real payment.
if (!stripeSecretKey.startsWith('sk_test_')) {
  throw new Error('STRIPE_SECRET_KEY must start with "sk_test_" -- refusing to start with a live key in this demo');
}

const stripe = new Stripe(stripeSecretKey);

module.exports = stripe;
