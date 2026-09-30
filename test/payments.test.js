require('dotenv').config({ quiet: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const request = require('supertest');

const app = require('../app');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TEST_PASSWORD = 'Test-Password-123!';
const TEST_COMMISSION_RATE = 0.1;

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
let buyer;
let buyer2;
let addressId;
let originalCommissionRow;

const createdListingIds = [];
const createdUserIds = [];

before(async () => {
  seller1 = await createTestUser('seller1', 'seller');
  buyer = await createTestUser('buyer', 'buyer');
  buyer2 = await createTestUser('buyer2', 'buyer');
  createdUserIds.push(seller1.id, buyer.id, buyer2.id);

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

// --- POST /api/checkout/pay (real Stripe test-mode API calls -- sk_test_
// only, no real charge is possible) ------------------------------------

let payListing;
let payOrder;

test('checkout/pay: creates a real Stripe Checkout Session for the order total', async () => {
  payListing = await createListing(seller1.id, { title: 'Pay Listing', price: 22, stock: 5 });
  createdListingIds.push(payListing.id);

  await addToCart(buyer.token, payListing.id, 2); // 44 total
  const payCheckout = await runCheckout(buyer.token, addressId);
  payOrder = payCheckout.orders[0];

  const res = await request(app)
    .post('/api/checkout/pay')
    .set('Authorization', `Bearer ${buyer.token}`)
    .send({ order_id: payOrder.id });

  assert.equal(res.status, 201);
  assert.ok(res.body.url && res.body.url.startsWith('https://checkout.stripe.com/'), 'must return a real Stripe-hosted URL');

  const { data: order } = await admin.from('orders').select('payment_reference').eq('id', payOrder.id).single();
  assert.ok(order.payment_reference && order.payment_reference.startsWith('cs_'), 'Stripe session id must be stored on the order');
});

test('checkout/pay: missing order_id is rejected with 400', async () => {
  const res = await request(app).post('/api/checkout/pay').set('Authorization', `Bearer ${buyer.token}`).send({});
  assert.equal(res.status, 400);
});

test('checkout/pay: an order belonging to a different buyer is rejected with 404', async () => {
  const res = await request(app)
    .post('/api/checkout/pay')
    .set('Authorization', `Bearer ${buyer2.token}`)
    .send({ order_id: payOrder.id });
  assert.equal(res.status, 404);
});

test('checkout/pay: an order that is not awaiting payment is rejected with 400', async () => {
  await admin.from('orders').update({ status: 'paid' }).eq('id', payOrder.id);
  const res = await request(app)
    .post('/api/checkout/pay')
    .set('Authorization', `Bearer ${buyer.token}`)
    .send({ order_id: payOrder.id });
  assert.equal(res.status, 400);
  await admin.from('orders').update({ status: 'pending_payment' }).eq('id', payOrder.id);
});

// --- GET /api/checkout/session-status -----------------------------------
//
// Only the "not paid yet" path is covered here -- confirming the "paid"
// path for real would mean actually completing Stripe's hosted checkout
// page (a real card entry flow), which isn't something to automate in an
// integration test. That path is exercised manually instead.

test('checkout/session-status: missing session_id is rejected with 400', async () => {
  const res = await request(app).get('/api/checkout/session-status').set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(res.status, 400);
});

test('checkout/session-status: unknown session_id is rejected with 404', async () => {
  const res = await request(app)
    .get('/api/checkout/session-status')
    .query({ session_id: 'cs_test_does_not_exist' })
    .set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(res.status, 404);
});

test('checkout/session-status: a session belonging to a different buyer is rejected with 404', async () => {
  const { data: order } = await admin.from('orders').select('payment_reference').eq('id', payOrder.id).single();
  const res = await request(app)
    .get('/api/checkout/session-status')
    .query({ session_id: order.payment_reference })
    .set('Authorization', `Bearer ${buyer2.token}`);
  assert.equal(res.status, 404);
});

test('checkout/session-status: an unpaid session reports the order as still pending_payment', async () => {
  const { data: order } = await admin.from('orders').select('payment_reference').eq('id', payOrder.id).single();
  const res = await request(app)
    .get('/api/checkout/session-status')
    .query({ session_id: order.payment_reference })
    .set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'pending_payment');
});
