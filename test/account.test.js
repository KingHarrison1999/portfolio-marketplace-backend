require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const request = require('supertest');

const app = require('../app');
const emailNotificationService = require('../services/emailNotificationService');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TEST_PASSWORD = 'Test-Password-123!';

async function createTestUser(label, role) {
  const email = `test-account-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

let buyer1;
let buyer2;
let seller;

let emailTestListing;

const createdUserIds = [];
const createdListingIds = [];

// A single before() hook -- two separate top-level before() calls in the
// same file don't reliably run in registration order against each other
// in node:test, which bit us here (the second one raced ahead of the
// first and saw `seller` as still undefined).
before(async () => {
  buyer1 = await createTestUser('buyer1', 'buyer');
  buyer2 = await createTestUser('buyer2', 'buyer');
  seller = await createTestUser('seller', 'seller');
  createdUserIds.push(buyer1.id, buyer2.id, seller.id);

  const { data: listing, error } = await admin
    .from('listings')
    .insert({ seller_id: seller.id, title: 'Email Test Listing', price: 10, stock: 5, status: 'active' })
    .select()
    .single();
  if (error) throw error;
  emailTestListing = listing;
  createdListingIds.push(emailTestListing.id);
});

after(async () => {
  if (createdListingIds.length > 0) {
    await admin.from('listings').delete().in('id', createdListingIds);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

// --- Profile: self-scoped only -----------------------------------------

test('profile: no auth is rejected with 401', async () => {
  const res = await request(app).get('/api/profile');
  assert.equal(res.status, 401);
});

test('profile: GET returns the caller\'s own profile, including email', async () => {
  const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${buyer1.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.id, buyer1.id);
  assert.equal(res.body.profile.email, buyer1.email);
  assert.equal(res.body.profile.role, 'buyer');
});

test('profile: PATCH updates display_name, bio, and avatar_url', async () => {
  const res = await request(app)
    .patch('/api/profile')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ display_name: 'Test Buyer One', bio: 'I collect vintage denim jackets.', avatar_url: 'https://example.com/a.png' });
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.display_name, 'Test Buyer One');
  assert.equal(res.body.profile.bio, 'I collect vintage denim jackets.');
  assert.equal(res.body.profile.avatar_url, 'https://example.com/a.png');
});

test('profile: PATCH silently ignores an attempt to change role or id', async () => {
  const res = await request(app)
    .patch('/api/profile')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ role: 'admin', id: buyer2.id, display_name: 'Still Buyer One' });
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.role, 'buyer', 'role must not be changeable via this endpoint');
  assert.equal(res.body.profile.id, buyer1.id, 'id must not be changeable via this endpoint');
  assert.equal(res.body.profile.display_name, 'Still Buyer One');
});

test('profile: a caller can never see or modify another user\'s profile -- there is no route for it', async () => {
  // GET/PATCH always act on req.user.id from the token, never a path
  // param or body field, so buyer2's own GET must return buyer2's data
  // even after buyer1 tried to write over buyer2's id above.
  const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${buyer2.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.id, buyer2.id);
  assert.notEqual(res.body.profile.display_name, 'Still Buyer One');
});

// --- Commission tier (self-declared, verified separately by an admin) ---

test('profile: PATCH commission_tier is rejected for a non-seller', async () => {
  const res = await request(app)
    .patch('/api/profile')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ commission_tier: 'business' });
  assert.equal(res.status, 400);

  const { data } = await admin.from('profiles').select('commission_tier').eq('id', buyer1.id).single();
  assert.equal(data.commission_tier, 'individual', 'must not have been changed');
});

test('profile: a seller can self-declare a commission tier, which starts unverified', async () => {
  const res = await request(app)
    .patch('/api/profile')
    .set('Authorization', `Bearer ${seller.token}`)
    .send({ commission_tier: 'business' });
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.commission_tier, 'business');
  assert.equal(res.body.profile.commission_tier_verified, false);
});

test('profile: admin-verifying, then re-declaring a different tier, resets verified back to false', async () => {
  const verifyRes = await admin
    .from('profiles')
    .update({ commission_tier_verified: true })
    .eq('id', seller.id)
    .select()
    .single();
  assert.equal(verifyRes.data.commission_tier_verified, true);

  const res = await request(app)
    .patch('/api/profile')
    .set('Authorization', `Bearer ${seller.token}`)
    .send({ commission_tier: 'charity' });
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.commission_tier, 'charity');
  assert.equal(res.body.profile.commission_tier_verified, false, 'a new claim must not inherit the old verification');
});

test('profile: PATCH rejects an invalid commission_tier value', async () => {
  const res = await request(app)
    .patch('/api/profile')
    .set('Authorization', `Bearer ${seller.token}`)
    .send({ commission_tier: 'wholesale' });
  assert.equal(res.status, 400);
});

// --- Become a seller -----------------------------------------------------

test('become-seller: 401 with no auth, 403 for a non-buyer', async () => {
  const noAuthRes = await request(app).post('/api/profile/become-seller');
  assert.equal(noAuthRes.status, 401);

  const sellerRes = await request(app).post('/api/profile/become-seller').set('Authorization', `Bearer ${seller.token}`);
  assert.equal(sellerRes.status, 403);
});

test('become-seller: rejects an invalid commission_tier', async () => {
  const freshBuyer = await createTestUser('become-seller-invalid', 'buyer');
  createdUserIds.push(freshBuyer.id);

  const res = await request(app)
    .post('/api/profile/become-seller')
    .set('Authorization', `Bearer ${freshBuyer.token}`)
    .send({ commission_tier: 'nonprofit' });
  assert.equal(res.status, 400);

  const { data } = await admin.from('profiles').select('role').eq('id', freshBuyer.id).single();
  assert.equal(data.role, 'buyer', 'role must not have changed on a rejected request');
});

test('become-seller: upgrades role and self-declares a commission tier, unverified', async () => {
  const freshBuyer = await createTestUser('become-seller-charity', 'buyer');
  createdUserIds.push(freshBuyer.id);

  const res = await request(app)
    .post('/api/profile/become-seller')
    .set('Authorization', `Bearer ${freshBuyer.token}`)
    .send({ commission_tier: 'charity' });
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'seller');
  assert.equal(res.body.commission_tier, 'charity');

  const { data } = await admin
    .from('profiles')
    .select('role, commission_tier, commission_tier_verified')
    .eq('id', freshBuyer.id)
    .single();
  assert.equal(data.role, 'seller');
  assert.equal(data.commission_tier, 'charity');
  assert.equal(data.commission_tier_verified, false);
});

test('become-seller: defaults to individual when commission_tier is omitted', async () => {
  const freshBuyer = await createTestUser('become-seller-default', 'buyer');
  createdUserIds.push(freshBuyer.id);

  const res = await request(app).post('/api/profile/become-seller').set('Authorization', `Bearer ${freshBuyer.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.commission_tier, 'individual');

  const { data } = await admin.from('profiles').select('commission_tier').eq('id', freshBuyer.id).single();
  assert.equal(data.commission_tier, 'individual');
});

// --- Delete account -------------------------------------------------------

test('DELETE /api/profile: no auth is rejected with 401', async () => {
  const res = await request(app).delete('/api/profile');
  assert.equal(res.status, 401);
});

test('DELETE /api/profile: a buyer with no sales history is really deleted', async () => {
  const throwaway = await createTestUser('delete-buyer', 'buyer');

  const res = await request(app).delete('/api/profile').set('Authorization', `Bearer ${throwaway.token}`);
  assert.equal(res.status, 204);

  const { data: authUser } = await admin.auth.admin.getUserById(throwaway.id);
  assert.equal(authUser?.user, null, 'the auth.users row should really be gone');

  const { data: profileRow } = await admin.from('profiles').select('id').eq('id', throwaway.id).maybeSingle();
  assert.equal(profileRow, null, 'the profiles row should have cascade-deleted with it');

  // Already deleted -- don't push to createdUserIds / don't double-delete in after().
});

test('DELETE /api/profile: a seller who has sold something is blocked, not deleted', async () => {
  const throwawaySeller = await createTestUser('delete-seller-with-sales', 'seller');
  createdUserIds.push(throwawaySeller.id);

  const { data: listing, error: listingError } = await admin
    .from('listings')
    .insert({ seller_id: throwawaySeller.id, title: 'Delete-Account Test Listing', price: 9, stock: 5, status: 'active' })
    .select()
    .single();
  if (listingError) throw listingError;
  createdListingIds.push(listing.id);

  const addAddressRes = await request(app)
    .post('/api/addresses')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ line1: '1 Delete Account Test St', city: 'Deleteville', postcode: 'DL1 1ET', country: 'United Kingdom' });
  assert.equal(addAddressRes.status, 201);

  const addToCartRes = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: listing.id, quantity: 1 });
  assert.equal(addToCartRes.status, 201);

  const checkoutRes = await request(app)
    .post('/api/checkout')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ shipping_address_id: addAddressRes.body.address.id });
  assert.equal(checkoutRes.status, 201);

  const res = await request(app).delete('/api/profile').set('Authorization', `Bearer ${throwawaySeller.token}`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /order line item/i);

  const { data: stillExists } = await admin.auth.admin.getUserById(throwawaySeller.id);
  assert.ok(stillExists?.user, 'the seller must NOT have been deleted -- their sale is real buyer1 purchase history');

  // Cleanup specific to this test (the seller stays -- deleted normally via
  // the file's after() hook -- but the order/listing/address created here
  // need cleaning up now since they're not tracked by the shared arrays).
  await admin.from('orders').delete().eq('id', checkoutRes.body.orders[0].id);
  await admin.from('addresses').delete().eq('id', addAddressRes.body.address.id);
});

test('DELETE /api/profile: a seller with zero sales can still delete their own account', async () => {
  const throwawaySeller = await createTestUser('delete-seller-no-sales', 'seller');

  const res = await request(app).delete('/api/profile').set('Authorization', `Bearer ${throwawaySeller.token}`);
  assert.equal(res.status, 204);

  const { data: authUser } = await admin.auth.admin.getUserById(throwawaySeller.id);
  assert.equal(authUser?.user, null);
});

// --- Notification preferences -------------------------------------------

test('notification-preferences: no auth is rejected with 401', async () => {
  const res = await request(app).get('/api/notification-preferences');
  assert.equal(res.status, 401);
});

test('notification-preferences: GET auto-creates with the schema defaults', async () => {
  const res = await request(app)
    .get('/api/notification-preferences')
    .set('Authorization', `Bearer ${buyer2.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.notification_preferences.user_id, buyer2.id);
  assert.equal(res.body.notification_preferences.email_order_updates, true);
  assert.equal(res.body.notification_preferences.email_marketing, false);
});

test('notification-preferences: PATCH updates a single field without touching the other', async () => {
  const res = await request(app)
    .patch('/api/notification-preferences')
    .set('Authorization', `Bearer ${buyer2.token}`)
    .send({ email_marketing: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.notification_preferences.email_marketing, true);
  assert.equal(res.body.notification_preferences.email_order_updates, true, 'untouched field stays as-is');
});

test('notification-preferences: PATCH rejects a non-boolean value', async () => {
  const res = await request(app)
    .patch('/api/notification-preferences')
    .set('Authorization', `Bearer ${buyer2.token}`)
    .send({ email_marketing: 'yes' });
  assert.equal(res.status, 400);
});

// --- Email notifications -------------------------------------------------
//
// No Resend API key or verified sending domain exists for this project
// (confirmed against Resend's own docs: domain verification requires real
// DNS access, which isn't available -- see the step 8 summary). These
// tests can't exercise a real send, so instead they prove the two things
// that actually matter: (1) the notification_preferences opt-out is
// checked and short-circuits BEFORE any send is attempted, and (2) when
// preferences allow it, the code reaches the real Resend call and is only
// stopped by the (current, expected) missing credentials -- not by a bug
// in the preference-checking logic itself. The two are distinguished by
// the returned `reason`.

function fakeOrder(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    buyer_id: buyer1.id,
    total: 10,
    order_items: [{ seller_id: seller.id }],
    ...overrides,
  };
}

test('email: sends (attempts to) an order-received email when the buyer has not opted out', async () => {
  // RESEND_API_KEY is now really configured (see the domain-verification
  // step), so this reaches the real Resend API -- it fails, but for a
  // different, equally-real reason: the test user's own @example.com
  // address isn't a Resend-allowed testing address. Proves the same thing
  // the old assertion did (reached the real send call), just via a
  // different real rejection now that credentials actually exist.
  const result = await emailNotificationService.sendOrderReceivedEmail(fakeOrder());
  assert.equal(result.sent, false);
  assert.match(result.reason, /Invalid `to` field/, 'reached the real send call, only blocked by the fake @example.com test address');
});

test('email: skips the order-received email once the buyer opts out, before ever reaching the provider', async () => {
  const optOutRes = await request(app)
    .patch('/api/notification-preferences')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ email_order_updates: false });
  assert.equal(optOutRes.status, 200);

  const result = await emailNotificationService.sendOrderReceivedEmail(fakeOrder());
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'opted_out');

  // restore for cleanliness / in case of re-runs against the same user
  await request(app)
    .patch('/api/notification-preferences')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ email_order_updates: true });
});

test('email: sends (attempts to) a new-order email to the order\'s seller', async () => {
  // Same reasoning as the order-received test above.
  const result = await emailNotificationService.sendNewOrderEmailToSeller(fakeOrder());
  assert.equal(result.sent, false);
  assert.match(result.reason, /Invalid `to` field/);
});

test('email: a real checkout does not fail even though email sending is unconfigured', async () => {
  const addressRes = await request(app).post('/api/addresses').set('Authorization', `Bearer ${buyer1.token}`).send({
    line1: '1 Email Test St',
    city: 'Emailville',
    postcode: 'EM1 1TS',
    country: 'United Kingdom',
  });
  assert.equal(addressRes.status, 201);

  const addRes = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ listing_id: emailTestListing.id, quantity: 1 });
  assert.equal(addRes.status, 201);

  const checkoutRes = await request(app)
    .post('/api/checkout')
    .set('Authorization', `Bearer ${buyer1.token}`)
    .send({ shipping_address_id: addressRes.body.address.id });

  assert.equal(checkoutRes.status, 201, 'checkout must succeed regardless of email sending being unconfigured');
  assert.equal(checkoutRes.body.orders.length, 1);

  await admin.from('orders').delete().eq('id', checkoutRes.body.orders[0].id);
  await admin.from('addresses').delete().eq('id', addressRes.body.address.id);
});
