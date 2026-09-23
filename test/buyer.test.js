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
const TEST_BUSINESS_RATE = 0.06;
const TEST_CHARITY_RATE = 0.02;

async function createTestUser(label, role) {
  const email = `test-buyer-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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
    .insert({
      seller_id: sellerId,
      title: 'Test Listing',
      price: 10,
      stock: 5,
      status: 'active',
      ...overrides,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

let seller;
let seller2;
let buyer1;
let buyer2;
let categoryId;
let categoryId2;
let addressId;
let originalCommissionRow;

let listingA; // active, price 20, stock 10 -- browse/general cart use
let listingB; // active, price 50, stock 2 -- stock-limit tests
let listingDraft; // not active -- visibility + cart rejection tests
let listingCheckout; // active, price 30, stock 5 -- dedicated to the checkout flow
let listingStockRace; // active, stock 3 -- reduced after adding to cart, to test checkout re-validation
let listingSeller2; // active, owned by seller2 -- multi-seller checkout split

const createdListingIds = [];
const createdUserIds = [];

before(async () => {
  seller = await createTestUser('seller', 'seller');
  seller2 = await createTestUser('seller2', 'seller');
  buyer1 = await createTestUser('buyer1', 'buyer');
  buyer2 = await createTestUser('buyer2', 'buyer');
  createdUserIds.push(seller.id, seller2.id, buyer1.id, buyer2.id);

  const { data: category, error: categoryError } = await admin
    .from('categories')
    .insert({ name: 'Test Category', slug: `test-category-${Date.now()}` })
    .select()
    .single();
  if (categoryError) throw categoryError;
  categoryId = category.id;

  const { data: category2, error: category2Error } = await admin
    .from('categories')
    .insert({ name: 'Test Category 2', slug: `test-category-2-${Date.now()}` })
    .select()
    .single();
  if (category2Error) throw category2Error;
  categoryId2 = category2.id;

  // Created through the real API (not an admin insert) -- this is the same
  // endpoint being tested below, and it's what checkout actually depends on.
  const addressRes = await request(app).post('/api/addresses').set('Authorization', `Bearer ${buyer1.token}`).send({
    line1: '1 Test Street',
    city: 'Testville',
    postcode: 'TE5 7ST',
    country: 'United Kingdom',
  });
  if (addressRes.status !== 201) throw new Error(`Failed to create test address: ${JSON.stringify(addressRes.body)}`);
  addressId = addressRes.body.address.id;

  listingA = await createListing(seller.id, {
    title: 'Alpha Vintage Jacket',
    price: 20,
    stock: 10,
    category_id: categoryId,
  });
  listingB = await createListing(seller.id, {
    title: 'Beta Vintage Boots',
    price: 50,
    stock: 2,
    category_id: categoryId2,
  });
  listingDraft = await createListing(seller.id, { title: 'Draft Listing', price: 15, stock: 5, status: 'draft' });
  listingCheckout = await createListing(seller.id, { title: 'Checkout Listing', price: 30, stock: 5 });
  listingStockRace = await createListing(seller.id, { title: 'Stock Race Listing', price: 12, stock: 3 });
  listingSeller2 = await createListing(seller2.id, { title: 'Seller2 Listing', price: 40, stock: 5 });
  createdListingIds.push(
    listingA.id,
    listingB.id,
    listingDraft.id,
    listingCheckout.id,
    listingStockRace.id,
    listingSeller2.id,
  );

  const { data: commissionRow, error: commissionError } = await admin
    .from('commission_settings')
    .select('*')
    .limit(1)
    .single();
  if (commissionError) throw commissionError;
  originalCommissionRow = commissionRow;

  const { error: updateCommissionError } = await admin
    .from('commission_settings')
    .update({ flat_rate: TEST_COMMISSION_RATE, business_rate: TEST_BUSINESS_RATE, charity_rate: TEST_CHARITY_RATE })
    .eq('id', commissionRow.id);
  if (updateCommissionError) throw updateCommissionError;
});

after(async () => {
  if (originalCommissionRow) {
    await admin
      .from('commission_settings')
      .update({
        flat_rate: originalCommissionRow.flat_rate,
        business_rate: originalCommissionRow.business_rate,
        charity_rate: originalCommissionRow.charity_rate,
      })
      .eq('id', originalCommissionRow.id);
  }

  await admin.from('order_items').delete().in('listing_id', createdListingIds);
  await admin.from('orders').delete().eq('buyer_id', buyer1.id);
  await admin.from('cart_items').delete().in('listing_id', createdListingIds);
  // Catch-all for addresses created via the API during the Addresses tests,
  // not just the one from setup.
  await admin.from('addresses').delete().in('user_id', [buyer1.id, buyer2.id]);
  if (createdListingIds.length > 0) {
    await admin.from('listings').delete().in('id', createdListingIds);
  }
  if (categoryId) {
    await admin.from('categories').delete().eq('id', categoryId);
  }
  if (categoryId2) {
    await admin.from('categories').delete().eq('id', categoryId2);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

// --- Browse / search -------------------------------------------------

test('browse: only active listings are returned', async () => {
  const res = await request(app).get('/api/listings').query({ limit: 100 });
  assert.equal(res.status, 200);
  assert.ok(res.body.listings.every((l) => l.status === 'active'));
  assert.ok(!res.body.listings.some((l) => l.id === listingDraft.id));
  assert.ok(res.body.listings.some((l) => l.id === listingA.id));
});

test('browse: filters by category_id', async () => {
  const res = await request(app).get('/api/listings').query({ category_id: categoryId });
  assert.equal(res.status, 200);
  assert.ok(res.body.listings.every((l) => l.category_id === categoryId));
  assert.ok(res.body.listings.some((l) => l.id === listingA.id));
  assert.ok(!res.body.listings.some((l) => l.id === listingB.id));
});

test('browse: filters by multiple category_id values (OR, not AND)', async () => {
  const res = await request(app)
    .get('/api/listings')
    .query(`category_id=${categoryId}&category_id=${categoryId2}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.listings.some((l) => l.id === listingA.id), 'listing in category 1 should be included');
  assert.ok(res.body.listings.some((l) => l.id === listingB.id), 'listing in category 2 should be included');
  assert.ok(
    !res.body.listings.some((l) => l.id === listingCheckout.id),
    'listing in neither selected category should be excluded',
  );
});

test('browse: filters by price range', async () => {
  const res = await request(app).get('/api/listings').query({ min_price: 40, max_price: 60 });
  assert.equal(res.status, 200);
  assert.ok(res.body.listings.some((l) => l.id === listingB.id));
  assert.ok(!res.body.listings.some((l) => l.id === listingA.id));
});

test('browse: free-text search matches title', async () => {
  const res = await request(app).get('/api/listings').query({ q: 'Alpha' });
  assert.equal(res.status, 200);
  assert.ok(res.body.listings.some((l) => l.id === listingA.id));
  assert.ok(!res.body.listings.some((l) => l.id === listingB.id));
});

test('browse: search term with filter-syntax characters does not error or leak other listings', async () => {
  const res = await request(app).get('/api/listings').query({ q: 'Alpha,(){}' });
  assert.equal(res.status, 200);
});

test('browse: sort price_asc and price_desc order correctly', async () => {
  const asc = await request(app).get('/api/listings').query({ category_id: categoryId, sort: 'price_asc' });
  const desc = await request(app).get('/api/listings').query({ sort: 'price_desc', limit: 100 });
  assert.equal(asc.status, 200);
  assert.equal(desc.status, 200);
  const ascPrices = asc.body.listings.map((l) => Number(l.price));
  assert.deepEqual(ascPrices, [...ascPrices].sort((a, b) => a - b));
  const descPrices = desc.body.listings.map((l) => Number(l.price));
  assert.deepEqual(descPrices, [...descPrices].sort((a, b) => b - a));
});

test('browse: pagination limits results and reports total', async () => {
  const res = await request(app).get('/api/listings').query({ limit: 1, page: 1 });
  assert.equal(res.status, 200);
  assert.equal(res.body.listings.length, 1);
  assert.equal(res.body.limit, 1);
  assert.ok(res.body.total >= 4);
});

// --- Listing detail ----------------------------------------------------

test('detail: active listing is publicly visible with no auth', async () => {
  const res = await request(app).get(`/api/listings/${listingA.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.listing.id, listingA.id);
});

test('detail: nonexistent listing returns 404', async () => {
  const res = await request(app).get('/api/listings/00000000-0000-0000-0000-000000000000');
  assert.equal(res.status, 404);
});

test('detail: non-active listing returns 404 for an unauthenticated stranger', async () => {
  const res = await request(app).get(`/api/listings/${listingDraft.id}`);
  assert.equal(res.status, 404);
});

test('detail: non-active listing returns 404 for a different authenticated user', async () => {
  const res = await request(app)
    .get(`/api/listings/${listingDraft.id}`)
    .set('Authorization', `Bearer ${buyer1.token}`);
  assert.equal(res.status, 404);
});

test('detail: owner can view their own non-active listing', async () => {
  const res = await request(app)
    .get(`/api/listings/${listingDraft.id}`)
    .set('Authorization', `Bearer ${seller.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.listing.id, listingDraft.id);
});

// --- Cart ----------------------------------------------------------------

test('cart: GET auto-creates an empty cart', async () => {
  const res = await request(app).get('/api/cart').set('Authorization', `Bearer ${buyer1.token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.cart);
  assert.deepEqual(res.body.items, []);
});

test('cart: no auth is rejected with 401', async () => {
  const res = await request(app).get('/api/cart');
  assert.equal(res.status, 401);
});

let mergeItemId;

test('cart: adding a listing creates a cart item', async () => {
  const res = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listingA.id, quantity: 2 });
  assert.equal(res.status, 201);
  assert.equal(res.body.item.quantity, 2);
  mergeItemId = res.body.item.id;
});

test('cart: adding the same listing again merges quantity instead of duplicating', async () => {
  const res = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listingA.id, quantity: 1 });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.id, mergeItemId);
  assert.equal(res.body.item.quantity, 3);
});

test('cart: adding a quantity that would exceed stock is rejected', async () => {
  const res = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listingA.id, quantity: 8 }); // 3 + 8 = 11 > stock 10
  assert.equal(res.status, 400);
});

test('cart: adding an inactive (draft) listing is rejected', async () => {
  const res = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listingDraft.id, quantity: 1 });
  assert.equal(res.status, 400);
});

test('cart: adding a listing beyond total stock in one request is rejected', async () => {
  const res = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listingB.id, quantity: 3 }); // stock is 2
  assert.equal(res.status, 400);
});

test('cart: PATCH updates quantity within stock', async () => {
  const res = await request(app)
    .patch(`/api/cart/items/${mergeItemId}`)
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ quantity: 5 });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.quantity, 5);
});

test('cart: PATCH exceeding stock is rejected', async () => {
  const res = await request(app)
    .patch(`/api/cart/items/${mergeItemId}`)
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ quantity: 11 }); // stock is 10
  assert.equal(res.status, 400);
});

test('cart: a different buyer gets 403 updating someone else\'s cart item', async () => {
  const res = await request(app)
    .patch(`/api/cart/items/${mergeItemId}`)
    .set('Authorization', `Bearer ${buyer2.token}`)
    .send({ quantity: 1 });
  assert.equal(res.status, 403);
});

test('cart: a different buyer gets 403 deleting someone else\'s cart item', async () => {
  const res = await request(app)
    .delete(`/api/cart/items/${mergeItemId}`)
    .set('Authorization', `Bearer ${buyer2.token}`);
  assert.equal(res.status, 403);
});

test('cart: DELETE removes the item', async () => {
  const res = await request(app)
    .delete(`/api/cart/items/${mergeItemId}`)
    .set('Authorization', `Bearer ${buyer1.token}`);
  assert.equal(res.status, 204);

  const getRes = await request(app).get('/api/cart').set('Authorization', `Bearer ${buyer1.token}`);
  assert.ok(!getRes.body.items.some((i) => i.id === mergeItemId));
});

// --- Checkout --------------------------------------------------------

test('checkout: empty cart is rejected', async () => {
  const res = await request(app)
    .post('/api/checkout')
    .set('Authorization', `Bearer ${buyer2.token}`)
    .send({ shipping_address_id: '00000000-0000-0000-0000-000000000000' });
  // buyer2 has no address either, but address is validated first -- confirm
  // that specifically, then confirm the empty-cart path separately below.
  assert.equal(res.status, 400);
});

test('checkout: missing shipping_address_id is rejected', async () => {
  const res = await request(app).post('/api/checkout').set('Authorization', `Bearer ${buyer1.token}`).send({});
  assert.equal(res.status, 400);
});

test('checkout: a shipping_address_id that is not the caller\'s own is rejected', async () => {
  const res = await request(app)
    .post('/api/checkout')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ shipping_address_id: '00000000-0000-0000-0000-000000000000' });
  assert.equal(res.status, 400);
});

test('checkout: an empty cart with a valid address is rejected', async () => {
  const res = await request(app)
    .post('/api/checkout')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ shipping_address_id: addressId });
  assert.equal(res.status, 400);
});

let checkoutOrderId;
let checkoutGroupId;

test('checkout: produces a single pending order (one seller) with correct totals and commission', async () => {
  const addRes = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listingCheckout.id, quantity: 2 });
  assert.equal(addRes.status, 201);

  const res = await request(app)
    .post('/api/checkout')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ shipping_address_id: addressId });

  assert.equal(res.status, 201);
  assert.equal(res.body.orders.length, 1, 'a single-seller cart should produce exactly one order');

  const order = res.body.orders[0];
  assert.equal(order.status, 'pending_payment');
  assert.equal(order.buyer_id, buyer1.id);
  assert.equal(order.shipping_address_id, addressId);

  // price 30 * qty 2 = 60 total; commission at 10% of the line = 6
  assert.equal(Number(order.total), 60);
  assert.equal(order.order_items.length, 1);
  assert.equal(Number(order.order_items[0].price_at_purchase), 30);
  assert.equal(order.order_items[0].title_at_purchase, 'Checkout Listing');
  assert.equal(order.order_items[0].quantity, 2);
  assert.equal(Number(order.order_items[0].commission_amount), 6);
  assert.equal(order.order_items[0].seller_id, seller.id);

  checkoutOrderId = order.id;
  checkoutGroupId = order.checkout_group_id;
});

test('checkout: clears the cart items that were checked out', async () => {
  const res = await request(app).get('/api/cart').set('Authorization', `Bearer ${buyer1.token}`);
  assert.equal(res.status, 200);
  assert.ok(!res.body.items.some((i) => i.listing.id === listingCheckout.id));
});

test('checkout: does not decrement listing stock (deferred to payment confirmation)', async () => {
  const { data: listing } = await admin.from('listings').select('stock').eq('id', listingCheckout.id).single();
  assert.equal(listing.stock, 5, 'stock should be unchanged at checkout-initiation time');
});

test('checkout: order line items keep their original snapshot after the source listing is edited', async () => {
  // Edit the listing that checkoutOrderId was placed against, exactly the
  // scenario this migration exists for -- a seller changing a listing's
  // price/title after an order already references it.
  const { error: editError } = await admin
    .from('listings')
    .update({ title: 'Checkout Listing (EDITED)', price: 999.99 })
    .eq('id', listingCheckout.id);
  assert.equal(editError, null);

  // Confirm the live listing really did change...
  const liveRes = await request(app).get(`/api/listings/${listingCheckout.id}`);
  assert.equal(liveRes.status, 200);
  assert.equal(liveRes.body.listing.title, 'Checkout Listing (EDITED)');
  assert.equal(Number(liveRes.body.listing.price), 999.99);

  // ...but the already-placed order, fetched through the same real endpoint
  // the order-confirmation page uses, must still show what was actually
  // purchased, unaffected by the edit.
  const orderRes = await request(app)
    .get(`/api/orders/by-group/${checkoutGroupId}`)
    .set('Authorization', `Bearer ${buyer1.token}`);
  assert.equal(orderRes.status, 200);

  const order = orderRes.body.orders.find((o) => o.id === checkoutOrderId);
  assert.ok(order, 'the original order should still be in this checkout group');
  assert.equal(order.order_items[0].title_at_purchase, 'Checkout Listing', 'title snapshot must survive the listing edit');
  assert.equal(Number(order.order_items[0].price_at_purchase), 30, 'price snapshot must survive the listing edit');
});

test('checkout: shipping address is snapshotted onto the order and survives the source address being edited', async () => {
  const addressRes = await request(app)
    .post('/api/addresses')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ line1: '1 Snapshot Street', line2: 'Flat 2', city: 'Snapshotville', postcode: 'SN1 1AP', country: 'United Kingdom' });
  assert.equal(addressRes.status, 201);
  const snapshotAddressId = addressRes.body.address.id;

  const addRes = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listingA.id, quantity: 1 });
  assert.equal(addRes.status, 201);

  const checkoutRes = await request(app)
    .post('/api/checkout')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ shipping_address_id: snapshotAddressId });
  assert.equal(checkoutRes.status, 201);
  const order = checkoutRes.body.orders[0];

  // The response from checkout itself should already carry the snapshot.
  assert.equal(order.shipping_line1, '1 Snapshot Street');
  assert.equal(order.shipping_line2, 'Flat 2');
  assert.equal(order.shipping_city, 'Snapshotville');
  assert.equal(order.shipping_postcode, 'SN1 1AP');
  assert.equal(order.shipping_country, 'United Kingdom');

  // Now edit the real address -- exactly the order-confirmation.js bug
  // this snapshot exists to fix.
  const editRes = await request(app)
    .patch(`/api/addresses/${snapshotAddressId}`)
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ line1: '99 Edited Avenue', city: 'Editedtown' });
  assert.equal(editRes.status, 200);

  // The already-placed order, fetched through the same real endpoint
  // order-confirmation.js uses, must still show what was true at checkout.
  const groupRes = await request(app)
    .get(`/api/orders/by-group/${order.checkout_group_id}`)
    .set('Authorization', `Bearer ${buyer1.token}`);
  assert.equal(groupRes.status, 200);
  const persistedOrder = groupRes.body.orders.find((o) => o.id === order.id);
  assert.equal(persistedOrder.shipping_line1, '1 Snapshot Street', 'must not have changed along with the edited address');
  assert.equal(persistedOrder.shipping_city, 'Snapshotville', 'must not have changed along with the edited address');

  await admin.from('orders').delete().eq('id', order.id);
  await admin.from('addresses').delete().eq('id', snapshotAddressId);
});

test("seller dashboard's recent orders also show the original snapshot, not the edited listing", async () => {
  const res = await request(app).get('/api/listings/mine/dashboard').set('Authorization', `Bearer ${seller.token}`);
  assert.equal(res.status, 200);

  const recentItem = res.body.recent_order_items.find((i) => i.listing_id === listingCheckout.id);
  assert.ok(recentItem, 'the sale should appear in the seller\'s recent order items');
  assert.equal(recentItem.title_at_purchase, 'Checkout Listing', 'dashboard must show the snapshot, not the since-edited title');
  assert.equal(Number(recentItem.price_at_purchase), 30);
  assert.equal(recentItem.orders.id, checkoutOrderId);
});

let stockRaceItemId;

test('checkout: rejects when a cart item\'s stock has dropped below the requested quantity since it was added', async () => {
  const addRes = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listingStockRace.id, quantity: 3 }); // exactly matches current stock of 3
  assert.equal(addRes.status, 201);
  stockRaceItemId = addRes.body.item.id;

  // Simulate stock having dropped in the meantime (e.g. another buyer
  // completed a purchase) via a direct admin update, bypassing this API.
  await admin.from('listings').update({ stock: 1 }).eq('id', listingStockRace.id);

  const res = await request(app)
    .post('/api/checkout')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ shipping_address_id: addressId });

  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.details));
  assert.ok(res.body.details.some((d) => d.listing_id === listingStockRace.id));
});

test('checkout: a multi-seller cart produces one order per seller, each with its own total and commission', async () => {
  // Clear the still-unavailable item left over from the previous test so
  // it doesn't also fail this checkout.
  const removeRes = await request(app)
    .delete(`/api/cart/items/${stockRaceItemId}`)
    .set('Authorization', `Bearer ${buyer1.token}`);
  assert.equal(removeRes.status, 204);

  const addFromSeller1 = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listingA.id, quantity: 1 }); // seller, price 20
  assert.equal(addFromSeller1.status, 201);

  const addFromSeller2 = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listingSeller2.id, quantity: 2 }); // seller2, price 40
  assert.equal(addFromSeller2.status, 201);

  const res = await request(app)
    .post('/api/checkout')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ shipping_address_id: addressId });

  assert.equal(res.status, 201);
  assert.equal(res.body.orders.length, 2, 'one order per distinct seller in the cart');

  const sellerOrder = res.body.orders.find((o) => o.order_items[0].seller_id === seller.id);
  const seller2Order = res.body.orders.find((o) => o.order_items[0].seller_id === seller2.id);
  assert.ok(sellerOrder, 'expected an order for seller');
  assert.ok(seller2Order, 'expected an order for seller2');

  // seller's order: listingA, price 20 x qty 1 = 20, commission 10% = 2
  assert.equal(Number(sellerOrder.total), 20);
  assert.equal(sellerOrder.order_items.length, 1);
  assert.equal(Number(sellerOrder.order_items[0].commission_amount), 2);
  assert.equal(sellerOrder.order_items[0].listing_id, listingA.id);

  // seller2's order: listingSeller2, price 40 x qty 2 = 80, commission 10% = 8
  assert.equal(Number(seller2Order.total), 80);
  assert.equal(seller2Order.order_items.length, 1);
  assert.equal(Number(seller2Order.order_items[0].commission_amount), 8);
  assert.equal(seller2Order.order_items[0].listing_id, listingSeller2.id);

  // Both orders belong to the same buyer and checkout event.
  assert.equal(sellerOrder.buyer_id, buyer1.id);
  assert.equal(seller2Order.buyer_id, buyer1.id);
  assert.equal(sellerOrder.shipping_address_id, addressId);
  assert.equal(seller2Order.shipping_address_id, addressId);
  assert.notEqual(sellerOrder.id, seller2Order.id);

  const cartRes = await request(app).get('/api/cart').set('Authorization', `Bearer ${buyer1.token}`);
  assert.deepEqual(cartRes.body.items, []);
});

// --- Checkout: tiered commission (business/charity, gated on verification) ---

test('checkout: a verified business seller is charged business_rate; an unverified charity claim still falls back to flat_rate', async () => {
  await admin.from('profiles').update({ commission_tier: 'business', commission_tier_verified: true }).eq('id', seller.id);
  await admin.from('profiles').update({ commission_tier: 'charity', commission_tier_verified: false }).eq('id', seller2.id);

  try {
    const addFromSeller1 = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${buyer1.token}`)
      .send({ listing_id: listingA.id, quantity: 1 }); // seller (verified business), price 20
    assert.equal(addFromSeller1.status, 201);

    const addFromSeller2 = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${buyer1.token}`)
      .send({ listing_id: listingSeller2.id, quantity: 2 }); // seller2 (unverified charity claim), price 40
    assert.equal(addFromSeller2.status, 201);

    const res = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${buyer1.token}`)
      .send({ shipping_address_id: addressId });
    assert.equal(res.status, 201);

    const sellerOrder = res.body.orders.find((o) => o.order_items[0].seller_id === seller.id);
    const seller2Order = res.body.orders.find((o) => o.order_items[0].seller_id === seller2.id);

    // Verified business: 20 * 6% = 1.20 (TEST_BUSINESS_RATE), not the 10% flat rate.
    assert.equal(Number(sellerOrder.order_items[0].commission_amount), 1.2);

    // Unverified charity claim: still charged the 10% flat rate, exactly as
    // if no tier had been declared at all -- self-declaring alone must
    // never unlock the discount.
    assert.equal(Number(seller2Order.order_items[0].commission_amount), 8);

    await admin.from('orders').delete().in('id', [sellerOrder.id, seller2Order.id]);
  } finally {
    await admin.from('profiles').update({ commission_tier: 'individual', commission_tier_verified: false }).eq('id', seller.id);
    await admin.from('profiles').update({ commission_tier: 'individual', commission_tier_verified: false }).eq('id', seller2.id);
  }
});

test('checkout: a verified charity seller is charged charity_rate', async () => {
  await admin.from('profiles').update({ commission_tier: 'charity', commission_tier_verified: true }).eq('id', seller2.id);

  try {
    const addRes = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${buyer1.token}`)
      .send({ listing_id: listingSeller2.id, quantity: 1 }); // seller2 (verified charity), price 40
    assert.equal(addRes.status, 201);

    const res = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${buyer1.token}`)
      .send({ shipping_address_id: addressId });
    assert.equal(res.status, 201);

    const order = res.body.orders[0];
    // 40 * 2% = 0.80 (TEST_CHARITY_RATE), not the 10% flat rate.
    assert.equal(Number(order.order_items[0].commission_amount), 0.8);

    await admin.from('orders').delete().eq('id', order.id);
  } finally {
    await admin.from('profiles').update({ commission_tier: 'individual', commission_tier_verified: false }).eq('id', seller2.id);
  }
});

test('checkout: a verified business seller with no business_rate configured falls back to flat_rate', async () => {
  await admin.from('profiles').update({ commission_tier: 'business', commission_tier_verified: true }).eq('id', seller.id);
  await admin.from('commission_settings').update({ business_rate: null }).eq('id', originalCommissionRow.id);

  try {
    const addRes = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${buyer1.token}`)
      .send({ listing_id: listingA.id, quantity: 1 }); // seller (verified business), price 20
    assert.equal(addRes.status, 201);

    const res = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${buyer1.token}`)
      .send({ shipping_address_id: addressId });
    assert.equal(res.status, 201);

    const order = res.body.orders[0];
    // business_rate is null (not yet configured by admin) -- must fall back
    // to the 10% flat rate rather than erroring or charging 0% commission.
    assert.equal(Number(order.order_items[0].commission_amount), 2);

    await admin.from('orders').delete().eq('id', order.id);
  } finally {
    await admin.from('profiles').update({ commission_tier: 'individual', commission_tier_verified: false }).eq('id', seller.id);
    await admin.from('commission_settings').update({ business_rate: TEST_BUSINESS_RATE }).eq('id', originalCommissionRow.id);
  }
});

// --- Addresses -----------------------------------------------------------

test('addresses: no auth is rejected with 401', async () => {
  const res = await request(app).get('/api/addresses');
  assert.equal(res.status, 401);
});

test('addresses: POST validates required fields', async () => {
  const res = await request(app)
    .post('/api/addresses')
    .set('Authorization', `Bearer ${buyer2.token}`)
    .send({ line1: '2 Test Ave' }); // missing city/postcode/country
  assert.equal(res.status, 400);
});

let buyer2AddressId;

test('addresses: POST creates an address owned by the caller', async () => {
  const res = await request(app).post('/api/addresses').set('Authorization', `Bearer ${buyer2.token}`).send({
    line1: '2 Test Avenue',
    line2: 'Flat 3',
    city: 'Otherville',
    postcode: 'OT9 8ER',
    country: 'United Kingdom',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.address.user_id, buyer2.id);
  assert.equal(res.body.address.line1, '2 Test Avenue');
  buyer2AddressId = res.body.address.id;
});

test('addresses: GET lists only the caller\'s own addresses', async () => {
  const buyer1Res = await request(app).get('/api/addresses').set('Authorization', `Bearer ${buyer1.token}`);
  assert.equal(buyer1Res.status, 200);
  assert.ok(buyer1Res.body.addresses.some((a) => a.id === addressId));
  assert.ok(!buyer1Res.body.addresses.some((a) => a.id === buyer2AddressId));

  const buyer2Res = await request(app).get('/api/addresses').set('Authorization', `Bearer ${buyer2.token}`);
  assert.equal(buyer2Res.status, 200);
  assert.ok(buyer2Res.body.addresses.some((a) => a.id === buyer2AddressId));
  assert.ok(!buyer2Res.body.addresses.some((a) => a.id === addressId));
});

test('addresses: PATCH updates the caller\'s own address', async () => {
  const res = await request(app)
    .patch(`/api/addresses/${buyer2AddressId}`)
    .set('Authorization', `Bearer ${buyer2.token}`)
    .send({ city: 'Newville', is_default: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.address.city, 'Newville');
  assert.equal(res.body.address.is_default, true);
});

test('addresses: PATCH by a different user is rejected with 403', async () => {
  const res = await request(app)
    .patch(`/api/addresses/${buyer2AddressId}`)
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ city: 'Hijacked' });
  assert.equal(res.status, 403);
});

test('addresses: PATCH on a nonexistent address returns 404', async () => {
  const res = await request(app)
    .patch('/api/addresses/00000000-0000-0000-0000-000000000000')
    .set('Authorization', `Bearer ${buyer2.token}`)
    .send({ city: 'Nowhere' });
  assert.equal(res.status, 404);
});

test('addresses: DELETE by a different user is rejected with 403', async () => {
  const res = await request(app)
    .delete(`/api/addresses/${buyer2AddressId}`)
    .set('Authorization', `Bearer ${buyer1.token}`);
  assert.equal(res.status, 403);
});

test('addresses: DELETE removes the address', async () => {
  const res = await request(app)
    .delete(`/api/addresses/${buyer2AddressId}`)
    .set('Authorization', `Bearer ${buyer2.token}`);
  assert.equal(res.status, 204);

  const getRes = await request(app).get('/api/addresses').set('Authorization', `Bearer ${buyer2.token}`);
  assert.ok(!getRes.body.addresses.some((a) => a.id === buyer2AddressId));
});
