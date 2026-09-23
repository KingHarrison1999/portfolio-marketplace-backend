require('dotenv').config({ quiet: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const request = require('supertest');

const app = require('../app');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TEST_PASSWORD = 'Test-Password-123!';

async function createTestUser(label, role) {
  const email = `test-admin-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

let adminUser;
let buyer;
let seller;
let originalCommissionRow;
let baselineDashboard;

const createdListingIds = [];
const createdCategoryIds = [];
const createdAdSpaceIds = [];
const createdUserIds = [];

before(async () => {
  // The dashboard endpoint is admin-gated, so an admin has to exist before
  // baseline can even be captured -- that means the baseline itself already
  // includes +1 admin. buyer and seller are created AFTER baseline, so
  // their deltas below are accurate; the admin delta is asserted as 0 for
  // the same reason.
  adminUser = await createTestUser('admin', 'admin');
  createdUserIds.push(adminUser.id);

  const baselineRes = await request(app)
    .get('/api/admin/dashboard')
    .set('Authorization', `Bearer ${adminUser.token}`);
  if (baselineRes.status !== 200) throw new Error(`Failed to capture baseline dashboard: ${JSON.stringify(baselineRes.body)}`);
  baselineDashboard = baselineRes.body;

  buyer = await createTestUser('buyer', 'buyer');
  seller = await createTestUser('seller', 'seller');
  createdUserIds.push(buyer.id, seller.id);

  const { data: commissionRow, error: commissionError } = await admin
    .from('commission_settings')
    .select('*')
    .limit(1)
    .single();
  if (commissionError) throw commissionError;
  originalCommissionRow = commissionRow;
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
  if (createdAdSpaceIds.length > 0) {
    await admin.from('ad_spaces').delete().in('id', createdAdSpaceIds);
  }
  if (createdListingIds.length > 0) {
    await admin.from('listings').delete().in('id', createdListingIds);
  }
  if (createdCategoryIds.length > 0) {
    await admin.from('categories').delete().in('id', createdCategoryIds);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

// --- Non-admin 403s on every admin-gated route --------------------------

test('categories: GET is public -- works with no auth at all', async () => {
  const res = await request(app).get('/api/categories');
  assert.equal(res.status, 200);
});

test('categories: POST/PATCH/DELETE are 403 for a non-admin', async () => {
  const postRes = await request(app)
    .post('/api/categories')
    .set('Authorization', `Bearer ${buyer.token}`)
    .send({ name: 'x', slug: `x-${Date.now()}` });
  assert.equal(postRes.status, 403);

  const patchRes = await request(app)
    .patch('/api/categories/00000000-0000-0000-0000-000000000000')
    .set('Authorization', `Bearer ${buyer.token}`)
    .send({ name: 'y' });
  assert.equal(patchRes.status, 403);

  const deleteRes = await request(app)
    .delete('/api/categories/00000000-0000-0000-0000-000000000000')
    .set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(deleteRes.status, 403);
});

test('admin routes: 403 for a non-admin (seller included, not just buyer)', async () => {
  const routes = [
    ['get', '/api/admin/commission-settings'],
    ['patch', '/api/admin/commission-settings'],
    ['get', '/api/admin/ad-spaces'],
    ['post', '/api/admin/ad-spaces'],
    ['patch', '/api/admin/ad-spaces/00000000-0000-0000-0000-000000000000'],
    ['delete', '/api/admin/ad-spaces/00000000-0000-0000-0000-000000000000'],
    ['get', '/api/admin/dashboard'],
  ];

  for (const [method, path] of routes) {
    const buyerRes = await request(app)[method](path).set('Authorization', `Bearer ${buyer.token}`);
    assert.equal(buyerRes.status, 403, `${method.toUpperCase()} ${path} should 403 for a buyer`);

    const sellerRes = await request(app)[method](path).set('Authorization', `Bearer ${seller.token}`);
    assert.equal(sellerRes.status, 403, `${method.toUpperCase()} ${path} should 403 for a seller`);
  }
});

test('admin routes: 401 with no auth at all', async () => {
  const res = await request(app).get('/api/admin/dashboard');
  assert.equal(res.status, 401);
});

// --- Category management --------------------------------------------

let emptyCategory;
let usedCategory;

test('categories: admin can create a category', async () => {
  const res = await request(app)
    .post('/api/categories')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ name: 'Admin Test Category', slug: `admin-test-category-${Date.now()}` });
  assert.equal(res.status, 201);
  assert.equal(res.body.category.name, 'Admin Test Category');
  emptyCategory = res.body.category;
  createdCategoryIds.push(emptyCategory.id);
});

test('categories: admin can update a category', async () => {
  const res = await request(app)
    .patch(`/api/categories/${emptyCategory.id}`)
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ name: 'Renamed Category' });
  assert.equal(res.status, 200);
  assert.equal(res.body.category.name, 'Renamed Category');
});

test('categories: deleting an unused category succeeds', async () => {
  const res = await request(app)
    .delete(`/api/categories/${emptyCategory.id}`)
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 204);

  const { data } = await admin.from('categories').select('id').eq('id', emptyCategory.id).maybeSingle();
  assert.equal(data, null, 'category row should actually be gone');
  createdCategoryIds.splice(createdCategoryIds.indexOf(emptyCategory.id), 1);
});

test('categories: deleting a category with an active listing is blocked with 409', async () => {
  const createRes = await request(app)
    .post('/api/categories')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ name: 'Used Category', slug: `used-category-${Date.now()}` });
  assert.equal(createRes.status, 201);
  usedCategory = createRes.body.category;
  createdCategoryIds.push(usedCategory.id);

  const { data: listing, error } = await admin
    .from('listings')
    .insert({
      seller_id: seller.id,
      title: 'Category Delete Test Listing',
      price: 10,
      stock: 1,
      status: 'active',
      category_id: usedCategory.id,
    })
    .select()
    .single();
  if (error) throw error;
  createdListingIds.push(listing.id);

  const deleteRes = await request(app)
    .delete(`/api/categories/${usedCategory.id}`)
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(deleteRes.status, 409);

  const { data: stillExists } = await admin.from('categories').select('id').eq('id', usedCategory.id).maybeSingle();
  assert.ok(stillExists, 'category must still exist after a blocked delete');
});

test('categories: deletion is blocked only by ACTIVE listings, not others', async () => {
  // Soft-delete the listing (status -> removed) via the real seller flow,
  // then confirm the category can now be deleted.
  await admin.from('listings').update({ status: 'removed' }).eq('id', createdListingIds[0]);

  const res = await request(app)
    .delete(`/api/categories/${usedCategory.id}`)
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 204);
  createdCategoryIds.splice(createdCategoryIds.indexOf(usedCategory.id), 1);
});

// --- Commission settings ----------------------------------------------

test('commission-settings: admin GET returns the current row', async () => {
  const res = await request(app)
    .get('/api/admin/commission-settings')
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 200);
  assert.ok('flat_rate' in res.body.commission_settings);
  assert.ok('business_rate' in res.body.commission_settings);
  assert.ok('charity_rate' in res.body.commission_settings);
});

test('commission-settings: admin PATCH updates flat_rate', async () => {
  const res = await request(app)
    .patch('/api/admin/commission-settings')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ flat_rate: 0.15 });
  assert.equal(res.status, 200);
  assert.equal(Number(res.body.commission_settings.flat_rate), 0.15);

  const { data } = await admin.from('commission_settings').select('flat_rate').eq('id', originalCommissionRow.id).single();
  assert.equal(Number(data.flat_rate), 0.15);
});

test('commission-settings: PATCH rejects an out-of-range flat_rate', async () => {
  const res = await request(app)
    .patch('/api/admin/commission-settings')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ flat_rate: 1.5 });
  assert.equal(res.status, 400);
});

test('commission-settings: admin PATCH updates all three tiers together', async () => {
  const res = await request(app)
    .patch('/api/admin/commission-settings')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ flat_rate: 0.12, business_rate: 0.18, charity_rate: 0.05 });
  assert.equal(res.status, 200);
  assert.equal(Number(res.body.commission_settings.flat_rate), 0.12);
  assert.equal(Number(res.body.commission_settings.business_rate), 0.18);
  assert.equal(Number(res.body.commission_settings.charity_rate), 0.05);

  const { data } = await admin
    .from('commission_settings')
    .select('flat_rate, business_rate, charity_rate')
    .eq('id', originalCommissionRow.id)
    .single();
  assert.equal(Number(data.flat_rate), 0.12);
  assert.equal(Number(data.business_rate), 0.18);
  assert.equal(Number(data.charity_rate), 0.05);
});

test('commission-settings: PATCH with only flat_rate leaves business_rate/charity_rate untouched', async () => {
  const res = await request(app)
    .patch('/api/admin/commission-settings')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ flat_rate: 0.2 });
  assert.equal(res.status, 200);
  assert.equal(Number(res.body.commission_settings.flat_rate), 0.2);
  assert.equal(Number(res.body.commission_settings.business_rate), 0.18, 'untouched field stays as-is');
  assert.equal(Number(res.body.commission_settings.charity_rate), 0.05, 'untouched field stays as-is');
});

test('commission-settings: PATCH rejects an out-of-range business_rate or charity_rate', async () => {
  const businessRes = await request(app)
    .patch('/api/admin/commission-settings')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ flat_rate: 0.1, business_rate: 1.2 });
  assert.equal(businessRes.status, 400);

  const charityRes = await request(app)
    .patch('/api/admin/commission-settings')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ flat_rate: 0.1, charity_rate: -0.05 });
  assert.equal(charityRes.status, 400);
});

// --- Ad spaces ------------------------------------------------------

let adSpace;

test('ad-spaces: validates required fields on create', async () => {
  const res = await request(app)
    .post('/api/admin/ad-spaces')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ business_name: 'Only A Name' }); // missing placement, start_date
  assert.equal(res.status, 400);
});

test('ad-spaces: admin can create an ad space', async () => {
  const res = await request(app)
    .post('/api/admin/ad-spaces')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({
      owner_id: seller.id,
      business_name: 'Test Vintage Co',
      placement: 'homepage-hero',
      image_url: 'https://example.com/ad.png',
      click_through_url: 'https://example.com',
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      price: 99.99,
    });
  assert.equal(res.status, 201);
  assert.equal(res.body.ad_space.business_name, 'Test Vintage Co');
  assert.equal(res.body.ad_space.is_active, true);
  adSpace = res.body.ad_space;
  createdAdSpaceIds.push(adSpace.id);
});

test('ad-spaces: business_name is optional -- a house/no-owner promo can be created without one', async () => {
  const res = await request(app)
    .post('/api/admin/ad-spaces')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({
      placement: 'site-announcement',
      click_through_url: 'https://instagram.com/example',
      start_date: '2026-09-01',
    });
  assert.equal(res.status, 201);
  assert.equal(res.body.ad_space.business_name, null);
  createdAdSpaceIds.push(res.body.ad_space.id);

  // The public read path (real end-to-end check, not just the create response)
  // must also tolerate a null business_name for an active ad in this placement.
  const publicRes = await request(app).get('/api/ad-spaces').query({ placement: 'site-announcement' });
  assert.equal(publicRes.status, 200);
  const found = publicRes.body.ad_spaces.find((a) => a.id === res.body.ad_space.id);
  assert.ok(found);
  assert.equal(found.business_name, null);
});

test('ad-spaces: rejects end_date before start_date', async () => {
  const res = await request(app)
    .post('/api/admin/ad-spaces')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({
      business_name: 'Bad Dates Co',
      placement: 'homepage-hero',
      start_date: '2026-09-30',
      end_date: '2026-09-01',
    });
  assert.equal(res.status, 400);
});

test('ad-spaces: GET list includes the created ad space', async () => {
  const res = await request(app).get('/api/admin/ad-spaces').set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.ad_spaces.some((a) => a.id === adSpace.id));
});

test('ad-spaces: admin can edit an ad space', async () => {
  const res = await request(app)
    .patch(`/api/admin/ad-spaces/${adSpace.id}`)
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ price: 149.99 });
  assert.equal(res.status, 200);
  assert.equal(Number(res.body.ad_space.price), 149.99);
});

test('ad-spaces: DELETE deactivates rather than hard-deleting', async () => {
  const res = await request(app)
    .delete(`/api/admin/ad-spaces/${adSpace.id}`)
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ad_space.is_active, false);

  const { data: stillExists } = await admin.from('ad_spaces').select('id, is_active').eq('id', adSpace.id).single();
  assert.ok(stillExists, 'row should still exist after "delete"');
  assert.equal(stillExists.is_active, false);
});

test('ad-spaces: PATCH on a nonexistent ad space returns 404', async () => {
  const res = await request(app)
    .patch('/api/admin/ad-spaces/00000000-0000-0000-0000-000000000000')
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ price: 1 });
  assert.equal(res.status, 404);
});

// --- Admin user lookup (ad-spaces owner picker) ------------------------

test('users: 401 with no auth, 403 for a non-admin', async () => {
  const noAuthRes = await request(app).get('/api/admin/users');
  assert.equal(noAuthRes.status, 401);

  const buyerRes = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(buyerRes.status, 403);
});

test('users: search by display_name fragment finds the right user, exact id lookup works too', async () => {
  const distinctiveName = `Zzyzx Test Advertiser ${Date.now()}`;
  const { error: updateErr } = await admin.from('profiles').update({ display_name: distinctiveName }).eq('id', seller.id);
  if (updateErr) throw updateErr;

  const searchRes = await request(app)
    .get('/api/admin/users')
    .query({ search: 'Zzyzx Test Advertiser' })
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.users.length, 1);
  assert.equal(searchRes.body.users[0].id, seller.id);
  assert.equal(searchRes.body.users[0].display_name, distinctiveName);
  assert.equal(searchRes.body.users[0].role, 'seller');

  const idRes = await request(app)
    .get('/api/admin/users')
    .query({ search: seller.id })
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(idRes.status, 200);
  assert.equal(idRes.body.users.length, 1);
  assert.equal(idRes.body.users[0].id, seller.id);
});

test('users: a name that matches nobody returns an empty list, not an error', async () => {
  const res = await request(app)
    .get('/api/admin/users')
    .query({ search: `no-such-user-${Date.now()}` })
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.users, []);
});

// --- Public "active ads for placement X" endpoint -----------------------

test('public ad spaces: placement query param is required', async () => {
  const res = await request(app).get('/api/ad-spaces');
  assert.equal(res.status, 400);
});

test('public ad spaces: returns only active, in-date-range ads for the requested placement, no auth required', async () => {
  const placement = `test-placement-${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const rows = [
    // Should be returned: active, started, open-ended.
    { business_name: 'Live Open-Ended Advertiser', placement, is_active: true, start_date: yesterday, end_date: null },
    // Should be returned: active, spans today exactly.
    { business_name: 'Live Bounded Advertiser', placement, is_active: true, start_date: yesterday, end_date: tomorrow },
    // Excluded: is_active false.
    { business_name: 'Deactivated Advertiser', placement, is_active: false, start_date: yesterday, end_date: null },
    // Excluded: starts in the future.
    { business_name: 'Not Started Yet Advertiser', placement, is_active: true, start_date: tomorrow, end_date: null },
    // Excluded: already ended.
    { business_name: 'Expired Advertiser', placement, is_active: true, start_date: yesterday, end_date: yesterday },
    // Excluded: right dates, wrong placement.
    { business_name: 'Wrong Placement Advertiser', placement: `${placement}-other`, is_active: true, start_date: yesterday, end_date: null },
  ];

  const { data: inserted, error } = await admin
    .from('ad_spaces')
    .insert(rows.map((r) => ({ business_name: r.business_name, placement: r.placement, is_active: r.is_active, start_date: r.start_date, end_date: r.end_date, image_url: 'https://example.com/x.png', click_through_url: 'https://example.com' })))
    .select();
  if (error) throw error;
  createdAdSpaceIds.push(...inserted.map((r) => r.id));

  const res = await request(app).get('/api/ad-spaces').query({ placement });
  assert.equal(res.status, 200);

  const names = res.body.ad_spaces.map((a) => a.business_name).sort();
  assert.deepEqual(names, ['Live Bounded Advertiser', 'Live Open-Ended Advertiser']);

  // Public shape check -- no owner_id/price leaked, only display fields.
  for (const ad of res.body.ad_spaces) {
    assert.ok('image_url' in ad);
    assert.ok('click_through_url' in ad);
    assert.equal('owner_id' in ad, false);
    assert.equal('price' in ad, false);
  }
});

test('public ad spaces: an unused placement returns an empty list, not an error', async () => {
  const res = await request(app).get('/api/ad-spaces').query({ placement: `no-such-placement-${Date.now()}` });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.ad_spaces, []);
});

// --- Admin user directory + suspend/reactivate (manage-users.html) ------

test('users/directory: 401 with no auth, 403 for a non-admin', async () => {
  const noAuthRes = await request(app).get('/api/admin/users/directory');
  assert.equal(noAuthRes.status, 401);

  const buyerRes = await request(app).get('/api/admin/users/directory').set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(buyerRes.status, 403);
});

test('users/directory: includes real email and role for known seeded users, not suspended by default', async () => {
  const res = await request(app).get('/api/admin/users/directory').set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 200);

  const found = res.body.users.find((u) => u.id === buyer.id);
  assert.ok(found, 'seeded buyer should be in the directory');
  assert.equal(found.email, buyer.email);
  assert.equal(found.role, 'buyer');
  assert.equal(found.is_suspended, false);
});

let suspendTarget;

test('users/suspend: 401 with no auth, 403 for a non-admin', async () => {
  suspendTarget = await createTestUser('suspend-target', 'buyer');
  createdUserIds.push(suspendTarget.id);

  const noAuthRes = await request(app).post(`/api/admin/users/${suspendTarget.id}/suspend`);
  assert.equal(noAuthRes.status, 401);

  const buyerRes = await request(app)
    .post(`/api/admin/users/${suspendTarget.id}/suspend`)
    .set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(buyerRes.status, 403);
});

test('users/suspend: an admin cannot suspend their own account', async () => {
  const res = await request(app)
    .post(`/api/admin/users/${adminUser.id}/suspend`)
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 400);
});

test('users/suspend: really bans the user -- they can no longer sign in, and the directory reflects it', async () => {
  const suspendRes = await request(app)
    .post(`/api/admin/users/${suspendTarget.id}/suspend`)
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(suspendRes.status, 200);
  assert.ok(suspendRes.body.user.banned_until, 'banned_until should be set on the real auth.users row');

  const signInRes = await anon.auth.signInWithPassword({ email: suspendTarget.email, password: TEST_PASSWORD });
  assert.ok(signInRes.error, 'a suspended user should not be able to sign in anymore');

  const dirRes = await request(app).get('/api/admin/users/directory').set('Authorization', `Bearer ${adminUser.token}`);
  const found = dirRes.body.users.find((u) => u.id === suspendTarget.id);
  assert.equal(found.is_suspended, true);
});

test('users/reactivate: un-bans the user -- they can sign in again', async () => {
  try {
    const reactivateRes = await request(app)
      .post(`/api/admin/users/${suspendTarget.id}/reactivate`)
      .set('Authorization', `Bearer ${adminUser.token}`);
    assert.equal(reactivateRes.status, 200);
    // GoTrue omits banned_until from the response entirely once cleared
    // (ban_duration: 'none'), rather than returning it as an explicit null.
    assert.ok(!reactivateRes.body.user.banned_until, 'banned_until should be cleared');

    const signInRes = await anon.auth.signInWithPassword({ email: suspendTarget.email, password: TEST_PASSWORD });
    assert.equal(signInRes.error, null, 'a reactivated user should be able to sign in again');

    const dirRes = await request(app).get('/api/admin/users/directory').set('Authorization', `Bearer ${adminUser.token}`);
    const found = dirRes.body.users.find((u) => u.id === suspendTarget.id);
    assert.equal(found.is_suspended, false);
  } finally {
    // Delete now rather than waiting for the after() hook -- the dashboard
    // test below asserts an exact "+1 new buyer since baseline" delta, and
    // suspendTarget is an extra buyer beyond the one `before()` already
    // seeded. In a finally block so a failed assertion above still doesn't
    // leave it behind to break that later test.
    await admin.auth.admin.deleteUser(suspendTarget.id);
    createdUserIds.splice(createdUserIds.indexOf(suspendTarget.id), 1);
  }
});

// --- Admin listings directory (manage-listings.html) ---------------------

test('admin listings: 401 with no auth, 403 for a non-admin', async () => {
  const noAuthRes = await request(app).get('/api/admin/listings');
  assert.equal(noAuthRes.status, 401);

  const buyerRes = await request(app).get('/api/admin/listings').set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(buyerRes.status, 403);
});

test('admin listings: includes every status across sellers, with seller_display_name and primary_image_url', async () => {
  const { error: nameErr } = await admin
    .from('profiles')
    .update({ display_name: 'Admin Listings Test Seller' })
    .eq('id', seller.id);
  if (nameErr) throw nameErr;

  const statuses = ['draft', 'active', 'sold', 'removed'];
  const insertedIds = [];
  for (const status of statuses) {
    const { data, error } = await admin
      .from('listings')
      .insert({ seller_id: seller.id, title: `Admin Listings Test - ${status}`, price: 9.99, stock: 1, status })
      .select()
      .single();
    if (error) throw error;
    insertedIds.push(data.id);
    createdListingIds.push(data.id);
  }

  try {
    const res = await request(app).get('/api/admin/listings').set('Authorization', `Bearer ${adminUser.token}`);
    assert.equal(res.status, 200);

    for (const id of insertedIds) {
      const found = res.body.listings.find((l) => l.id === id);
      assert.ok(found, `listing ${id} should be visible to admin regardless of status`);
      assert.equal(found.seller_display_name, 'Admin Listings Test Seller');
      assert.ok('primary_image_url' in found);
    }
  } finally {
    // Delete now rather than waiting for after() -- the dashboard test
    // below asserts an exact "+1 active listing since baseline" delta, and
    // the 'active'-status row seeded here would otherwise still be there.
    await admin.from('listings').delete().in('id', insertedIds);
    for (const id of insertedIds) {
      createdListingIds.splice(createdListingIds.indexOf(id), 1);
    }
  }
});

test('admin listings: admin can remove and reactivate a listing via the real listing endpoints, reflected here', async () => {
  const { data: listing, error } = await admin
    .from('listings')
    .insert({ seller_id: seller.id, title: 'Admin Moderation Target', price: 5, stock: 1, status: 'active' })
    .select()
    .single();
  if (error) throw error;
  createdListingIds.push(listing.id);

  try {
    const removeRes = await request(app)
      .delete(`/api/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminUser.token}`);
    assert.equal(removeRes.status, 200);
    assert.equal(removeRes.body.listing.status, 'removed');

    let dirRes = await request(app).get('/api/admin/listings').set('Authorization', `Bearer ${adminUser.token}`);
    let found = dirRes.body.listings.find((l) => l.id === listing.id);
    assert.equal(found.status, 'removed');

    const reactivateRes = await request(app)
      .patch(`/api/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminUser.token}`)
      .send({ status: 'active' });
    assert.equal(reactivateRes.status, 200);
    assert.equal(reactivateRes.body.listing.status, 'active');

    dirRes = await request(app).get('/api/admin/listings').set('Authorization', `Bearer ${adminUser.token}`);
    found = dirRes.body.listings.find((l) => l.id === listing.id);
    assert.equal(found.status, 'active');
  } finally {
    // Same reasoning as the previous test: don't leave an extra active
    // listing sitting around for the dashboard delta test below.
    await admin.from('listings').delete().eq('id', listing.id);
    createdListingIds.splice(createdListingIds.indexOf(listing.id), 1);
  }
});

// --- Commission tier verify/override (manage-users.html) ----------------

test('commission-tier: verify and override are 401 with no auth, 403 for a non-admin', async () => {
  const noAuthVerify = await request(app).post(`/api/admin/users/${seller.id}/verify-commission-tier`);
  assert.equal(noAuthVerify.status, 401);
  const buyerVerify = await request(app)
    .post(`/api/admin/users/${seller.id}/verify-commission-tier`)
    .set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(buyerVerify.status, 403);

  const noAuthOverride = await request(app).patch(`/api/admin/users/${seller.id}/commission-tier`);
  assert.equal(noAuthOverride.status, 401);
  const buyerOverride = await request(app)
    .patch(`/api/admin/users/${seller.id}/commission-tier`)
    .set('Authorization', `Bearer ${buyer.token}`)
    .send({ commission_tier: 'business' });
  assert.equal(buyerOverride.status, 403);
});

test('commission-tier: verify/override reject a non-seller with 400', async () => {
  const verifyRes = await request(app)
    .post(`/api/admin/users/${buyer.id}/verify-commission-tier`)
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(verifyRes.status, 400);

  const overrideRes = await request(app)
    .patch(`/api/admin/users/${buyer.id}/commission-tier`)
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ commission_tier: 'business' });
  assert.equal(overrideRes.status, 400);
});

test('commission-tier: verify on a nonexistent user returns 404', async () => {
  const res = await request(app)
    .post('/api/admin/users/00000000-0000-0000-0000-000000000000/verify-commission-tier')
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 404);
});

test('commission-tier: admin verifies a seller\'s self-declared tier without changing its value', async () => {
  // Simulates the seller's own PATCH /api/profile self-declaration (already
  // covered in account.test.js) directly, to isolate this test from that
  // endpoint.
  await admin.from('profiles').update({ commission_tier: 'business', commission_tier_verified: false }).eq('id', seller.id);

  const res = await request(app)
    .post(`/api/admin/users/${seller.id}/verify-commission-tier`)
    .set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.commission_tier, 'business', 'value must be unchanged by verify');
  assert.equal(res.body.profile.commission_tier_verified, true);
});

test('commission-tier: admin override sets a different tier and is implicitly verified', async () => {
  const res = await request(app)
    .patch(`/api/admin/users/${seller.id}/commission-tier`)
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ commission_tier: 'charity' });
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.commission_tier, 'charity');
  assert.equal(res.body.profile.commission_tier_verified, true);

  const { data } = await admin
    .from('profiles')
    .select('commission_tier, commission_tier_verified')
    .eq('id', seller.id)
    .single();
  assert.equal(data.commission_tier, 'charity');
  assert.equal(data.commission_tier_verified, true);
});

test('commission-tier: override rejects an invalid tier value', async () => {
  const res = await request(app)
    .patch(`/api/admin/users/${seller.id}/commission-tier`)
    .set('Authorization', `Bearer ${adminUser.token}`)
    .send({ commission_tier: 'wholesale' });
  assert.equal(res.status, 400);
});

test('commission-tier: users/directory reflects the current tier and verified status', async () => {
  const res = await request(app).get('/api/admin/users/directory').set('Authorization', `Bearer ${adminUser.token}`);
  const found = res.body.users.find((u) => u.id === seller.id);
  assert.equal(found.commission_tier, 'charity');
  assert.equal(found.commission_tier_verified, true);

  // Reset back to the default so this seller doesn't carry a stale tier
  // into any other test in this file that might run after this one.
  await admin.from('profiles').update({ commission_tier: 'individual', commission_tier_verified: false }).eq('id', seller.id);
});

// --- Dashboard ---------------------------------------------------------

test('dashboard: numbers reflect known seeded data (checked as a delta from baseline)', async () => {
  // seller and buyer from `before()` already added 1 seller + 1 buyer + 1
  // admin to profiles; add one more active listing so active_listings has
  // a known delta too.
  const { data: dashListing, error } = await admin
    .from('listings')
    .insert({ seller_id: seller.id, title: 'Dashboard Test Listing', price: 5, stock: 1, status: 'active' })
    .select()
    .single();
  if (error) throw error;
  createdListingIds.push(dashListing.id);

  const res = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminUser.token}`);
  assert.equal(res.status, 200);

  assert.equal(
    res.body.users_by_role.buyer - baselineDashboard.users_by_role.buyer,
    1,
    'exactly one new buyer since baseline',
  );
  assert.equal(
    res.body.users_by_role.seller - baselineDashboard.users_by_role.seller,
    1,
    'exactly one new seller since baseline',
  );
  assert.equal(
    res.body.users_by_role.admin - baselineDashboard.users_by_role.admin,
    0,
    'no new admin since baseline -- the admin used to capture baseline was created before it',
  );
  assert.equal(
    res.body.active_listings - baselineDashboard.active_listings,
    1,
    'exactly one new active listing since baseline',
  );

  assert.equal(res.body.commission_revenue.status, 'provisional');
  assert.equal(res.body.commission_revenue.currency, 'GBP');
  assert.match(res.body.commission_revenue.note, /not confirmed real revenue/i);
});
