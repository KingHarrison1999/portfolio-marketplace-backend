require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const request = require('supertest');

const app = require('../app');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TEST_PASSWORD = 'Test-Password-123!';
const TEST_COMMISSION_RATE = 0.1;
const WEBHOOK_SECRET = process.env.OPTIMISE_PAYMENTS_WEBHOOK_SECRET;

async function createTestUser(label, role) {
  const email = `test-payments-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createErr) throw createErr;

  if (role !== 'buyer') {
    const { error: roleErr } = await admin.from('profiles').update({ role }).eq('id', created.user.id);
    if (roleErr) throw roleErr;
  }

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signInErr) throw signInErr;

  return { id: created.user.id, email, token: signIn.session.access_token };
}

async function createListing(sellerId, overrides = {}) {
  const { data, error } = await admin
    .from('listings')
    .insert({ seller_id: sellerId, title: 'Test Listing', price: 10, stock: 5, status: 'active', ...overrides })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function signBody(bodyString) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(bodyString).digest('hex');
}

// supertest's .send(obj) re-serializes the object itself, so to control
// the exact bytes being signed (and verified) the raw string has to be
// sent with .send(string) and the content-type set explicitly.
function postSignedWebhook(payload, signatureOverride) {
  const bodyString = JSON.stringify(payload);
  const signature = signatureOverride !== undefined ? signatureOverride : signBody(bodyString);
  const req = request(app).post('/api/webhooks/optimise-payments').set('Content-Type', 'application/json');
  if (signature !== null) {
    req.set('x-optimise-signature', signature);
  }
  return req.send(bodyString);
}

async function runCheckout(buyerToken, addressId) {
  const res = await request(app)
    .post('/api/checkout')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ shipping_address_id: addressId });
  if (res.status !== 201) {
    throw new Error(`Checkout failed: ${JSON.stringify(res.body)}`);
  }
  return res.body; // { checkout_group_id, orders }
}

async function addToCart(buyerToken, listingId, quantity) {
  const res = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ listing_id: listingId, quantity });
  if (![200, 201].includes(res.status)) {
    throw new Error(`Add to cart failed: ${JSON.stringify(res.body)}`);
  }
}

let seller1;
let seller2;
let buyer;
let buyer2;
let addressId;
let originalCommissionRow;

const createdListingIds = [];
const createdUserIds = [];

before(async () => {
  if (!WEBHOOK_SECRET) {
    throw new Error('OPTIMISE_PAYMENTS_WEBHOOK_SECRET must be set to run payment tests');
  }

  seller1 = await createTestUser('seller1', 'seller');
  seller2 = await createTestUser('seller2', 'seller');
  buyer = await createTestUser('buyer', 'buyer');
  buyer2 = await createTestUser('buyer2', 'buyer');
  createdUserIds.push(seller1.id, seller2.id, buyer.id, buyer2.id);

  const addressRes = await request(app).post('/api/addresses').set('Authorization', `Bearer ${buyer.token}`).send({
    line1: '1 Payments Test St',
    city: 'Payville',
    postcode: 'PA1 1YT',
    country: 'United Kingdom',
  });
  if (addressRes.status !== 201) throw new Error(`Failed to create test address: ${JSON.stringify(addressRes.body)}`);
  addressId = addressRes.body.address.id;

  const { data: commissionRow, error: commissionError } = await admin
    .from('commission_settings')
    .select('*')
    .limit(1)
    .single();
  if (commissionError) throw commissionError;
  originalCommissionRow = commissionRow;

  const { error: updateCommissionError } = await admin
    .from('commission_settings')
    .update({ flat_rate: TEST_COMMISSION_RATE })
    .eq('id', commissionRow.id);
  if (updateCommissionError) throw updateCommissionError;
});

after(async () => {
  if (originalCommissionRow) {
    await admin
      .from('commission_settings')
      .update({ flat_rate: originalCommissionRow.flat_rate })
      .eq('id', originalCommissionRow.id);
  }

  await admin.from('order_items').delete().in('listing_id', createdListingIds);
  await admin.from('orders').delete().in('buyer_id', [buyer.id, buyer2.id]);
  await admin.from('cart_items').delete().in('listing_id', createdListingIds);
  await admin.from('addresses').delete().in('user_id', [buyer.id, buyer2.id]);
  if (createdListingIds.length > 0) {
    await admin.from('listings').delete().in('id', createdListingIds);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

// --- Signature verification ------------------------------------------

test('webhook: missing signature is rejected with 401', async () => {
  const res = await postSignedWebhook({ event: 'payment.succeeded', data: { reference: crypto.randomUUID() } }, null);
  assert.equal(res.status, 401);
});

test('webhook: invalid signature is rejected with 401', async () => {
  const res = await postSignedWebhook(
    { event: 'payment.succeeded', data: { reference: crypto.randomUUID() } },
    'not-a-real-signature',
  );
  assert.equal(res.status, 401);
});

test('webhook: valid signature for an unknown checkout_group_id is acknowledged as a no-op', async () => {
  const res = await postSignedWebhook({
    event: 'payment.succeeded',
    data: { reference: crypto.randomUUID(), session_id: 'sim_x', amount: 10 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.result, 'no_pending_orders');
});

test('webhook: unknown event type is acknowledged but ignored', async () => {
  const res = await postSignedWebhook({ event: 'something.else', data: { reference: crypto.randomUUID() } });
  assert.equal(res.status, 200);
  assert.equal(res.body.result, 'ignored_unknown_event');
});

// --- checkout_group_id / GET /api/orders/by-group/:id -----------------

let groupLookupListing;
let groupLookupCheckout;

test('checkout: response includes a checkout_group_id shared by sibling orders', async () => {
  groupLookupListing = await createListing(seller1.id, { title: 'Group Lookup Listing', price: 12, stock: 5 });
  createdListingIds.push(groupLookupListing.id);

  await addToCart(buyer.token, groupLookupListing.id, 1);
  groupLookupCheckout = await runCheckout(buyer.token, addressId);

  assert.ok(groupLookupCheckout.checkout_group_id);
  assert.equal(groupLookupCheckout.orders.length, 1);
  assert.equal(groupLookupCheckout.orders[0].checkout_group_id, groupLookupCheckout.checkout_group_id);
});

test('GET /api/orders/by-group/:id returns all sibling orders for the owning buyer', async () => {
  const res = await request(app)
    .get(`/api/orders/by-group/${groupLookupCheckout.checkout_group_id}`)
    .set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.orders.length, 1);
  assert.equal(res.body.orders[0].id, groupLookupCheckout.orders[0].id);
});

test('GET /api/orders/by-group/:id returns 404 for a different buyer', async () => {
  const res = await request(app)
    .get(`/api/orders/by-group/${groupLookupCheckout.checkout_group_id}`)
    .set('Authorization', `Bearer ${buyer2.token}`);
  assert.equal(res.status, 404);
});

test('GET /api/orders/by-group/:id with no auth is rejected with 401', async () => {
  const res = await request(app).get(`/api/orders/by-group/${groupLookupCheckout.checkout_group_id}`);
  assert.equal(res.status, 401);
});

// --- GET /api/orders/mine (account/dashboard.html, account/orders.html) --

test('GET /api/orders/mine: no auth is rejected with 401', async () => {
  const res = await request(app).get('/api/orders/mine');
  assert.equal(res.status, 401);
});

test('GET /api/orders/mine: returns every order the caller has ever placed, newest first, with real snapshot fields, and never another buyer\'s orders', async () => {
  const res = await request(app).get('/api/orders/mine').set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(res.status, 200);

  const found = res.body.orders.find((o) => o.id === groupLookupCheckout.orders[0].id);
  assert.ok(found, 'the order placed earlier in this file should be in the buyer\'s own history');
  assert.equal(found.order_items[0].title_at_purchase, 'Group Lookup Listing');
  assert.equal(Number(found.order_items[0].price_at_purchase), 12);

  assert.ok(
    res.body.orders.every((o) => o.buyer_id === buyer.id),
    'must never include another buyer\'s orders',
  );

  const dates = res.body.orders.map((o) => new Date(o.created_at).getTime());
  const sorted = [...dates].sort((a, b) => b - a);
  assert.deepEqual(dates, sorted, 'must be ordered newest-first');

  const buyer2Res = await request(app).get('/api/orders/mine').set('Authorization', `Bearer ${buyer2.token}`);
  assert.equal(buyer2Res.status, 200);
  assert.ok(
    !buyer2Res.body.orders.some((o) => o.id === groupLookupCheckout.orders[0].id),
    'a different buyer must not see this order in their own history',
  );
});

// --- POST /api/checkout/pay -------------------------------------------

let payListing;
let payCheckout;

test('checkout/pay: creates a payment session for the sum of sibling orders', async () => {
  payListing = await createListing(seller1.id, { title: 'Pay Listing', price: 22, stock: 5 });
  createdListingIds.push(payListing.id);

  await addToCart(buyer.token, payListing.id, 2); // 44 total
  payCheckout = await runCheckout(buyer.token, addressId);

  const res = await request(app)
    .post('/api/checkout/pay')
    .set('Authorization', `Bearer ${buyer.token}`)
    .send({ checkout_group_id: payCheckout.checkout_group_id });

  assert.equal(res.status, 201);
  assert.equal(Number(res.body.amount), 44);
  assert.equal(res.body.currency, 'GBP');
  assert.ok(res.body.session_id);
  assert.equal(res.body.redirect_url, null, 'no real payment page exists -- must not hand back a fake redirect');
  assert.equal(res.body.payment_connected, false, 'must tell the caller honestly that no real provider is wired up');
  assert.ok(res.body.message, 'must explain why in a message the frontend can show the buyer');

  const { data: order } = await admin
    .from('orders')
    .select('payment_reference')
    .eq('id', payCheckout.orders[0].id)
    .single();
  assert.equal(order.payment_reference, res.body.session_id);
});

test('checkout/pay: missing checkout_group_id is rejected with 400', async () => {
  const res = await request(app).post('/api/checkout/pay').set('Authorization', `Bearer ${buyer.token}`).send({});
  assert.equal(res.status, 400);
});

test('checkout/pay: a checkout_group_id belonging to a different buyer is rejected with 404', async () => {
  const res = await request(app)
    .post('/api/checkout/pay')
    .set('Authorization', `Bearer ${buyer2.token}`)
    .send({ checkout_group_id: payCheckout.checkout_group_id });
  assert.equal(res.status, 404);
});

// --- Successful multi-seller payment confirmation ----------------------

let successListing1;
let successListing2;
let successCheckout;

test('webhook: payment.succeeded confirms every sibling order across multiple sellers', async () => {
  successListing1 = await createListing(seller1.id, { title: 'Success Listing 1', price: 20, stock: 5 });
  successListing2 = await createListing(seller2.id, { title: 'Success Listing 2', price: 30, stock: 5 });
  createdListingIds.push(successListing1.id, successListing2.id);

  await addToCart(buyer.token, successListing1.id, 1);
  await addToCart(buyer.token, successListing2.id, 2);
  successCheckout = await runCheckout(buyer.token, addressId);
  assert.equal(successCheckout.orders.length, 2, 'expected one order per seller');

  const totalAmount = successCheckout.orders.reduce((sum, o) => sum + Number(o.total), 0);

  const res = await postSignedWebhook({
    event: 'payment.succeeded',
    data: { reference: successCheckout.checkout_group_id, session_id: 'sim_success', amount: totalAmount },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.result, 'paid');

  const { data: orders } = await admin
    .from('orders')
    .select('status')
    .eq('checkout_group_id', successCheckout.checkout_group_id);
  assert.ok(orders.every((o) => o.status === 'paid'));

  const { data: listing1 } = await admin.from('listings').select('stock').eq('id', successListing1.id).single();
  const { data: listing2 } = await admin.from('listings').select('stock').eq('id', successListing2.id).single();
  assert.equal(listing1.stock, 4, 'stock decremented by the ordered quantity (1)');
  assert.equal(listing2.stock, 3, 'stock decremented by the ordered quantity (2)');
});

test('webhook: redelivering the same payment.succeeded event is a no-op (idempotent)', async () => {
  const res = await postSignedWebhook({
    event: 'payment.succeeded',
    data: { reference: successCheckout.checkout_group_id, session_id: 'sim_success', amount: 80 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.result, 'no_pending_orders', 'orders are already paid, not pending_payment');

  const { data: listing1 } = await admin.from('listings').select('stock').eq('id', successListing1.id).single();
  assert.equal(listing1.stock, 4, 'stock must not be decremented a second time');
});

// --- All-or-nothing refund on a stock-change race -----------------------

let raceListing1;
let raceListing2;
let raceCheckout;

test('webhook: a stock change on one seller\'s item refunds the WHOLE group, not just that order', async () => {
  raceListing1 = await createListing(seller1.id, { title: 'Race Listing 1', price: 15, stock: 5 });
  raceListing2 = await createListing(seller2.id, { title: 'Race Listing 2', price: 25, stock: 2 });
  createdListingIds.push(raceListing1.id, raceListing2.id);

  await addToCart(buyer.token, raceListing1.id, 1);
  await addToCart(buyer.token, raceListing2.id, 2); // exactly matches current stock of 2
  raceCheckout = await runCheckout(buyer.token, addressId);
  assert.equal(raceCheckout.orders.length, 2);

  // Simulate another buyer completing a purchase for raceListing2 between
  // checkout and this payment confirmation -- stock drops below what this
  // order needs, but raceListing1 (seller1's item) is still fully fine.
  await admin.from('listings').update({ stock: 1 }).eq('id', raceListing2.id);

  const totalAmount = raceCheckout.orders.reduce((sum, o) => sum + Number(o.total), 0);
  const res = await postSignedWebhook({
    event: 'payment.succeeded',
    data: { reference: raceCheckout.checkout_group_id, session_id: 'sim_race', amount: totalAmount },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.result, 'refunded');
  assert.equal(res.body.reason, 'stock_or_availability_changed');

  const { data: orders } = await admin
    .from('orders')
    .select('status')
    .eq('checkout_group_id', raceCheckout.checkout_group_id);
  assert.equal(orders.length, 2);
  assert.ok(
    orders.every((o) => o.status === 'refunded'),
    'seller1\'s order must also be refunded even though its own item was fine -- all-or-nothing',
  );

  const { data: listing1 } = await admin.from('listings').select('stock').eq('id', raceListing1.id).single();
  assert.equal(listing1.stock, 5, 'unaffected listing\'s stock must not have been touched at all');
});

// --- Payment failure -----------------------------------------------------

let failedListing;
let failedCheckout;

test('webhook: payment.failed marks sibling orders payment_failed without touching stock', async () => {
  failedListing = await createListing(seller1.id, { title: 'Failed Listing', price: 18, stock: 5 });
  createdListingIds.push(failedListing.id);

  await addToCart(buyer.token, failedListing.id, 1);
  failedCheckout = await runCheckout(buyer.token, addressId);

  const res = await postSignedWebhook({
    event: 'payment.failed',
    data: { reference: failedCheckout.checkout_group_id },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.result, 'payment_failed');

  const { data: order } = await admin
    .from('orders')
    .select('status')
    .eq('id', failedCheckout.orders[0].id)
    .single();
  assert.equal(order.status, 'payment_failed');

  const { data: listing } = await admin.from('listings').select('stock').eq('id', failedListing.id).single();
  assert.equal(listing.stock, 5, 'a failed payment must never touch stock');
});
