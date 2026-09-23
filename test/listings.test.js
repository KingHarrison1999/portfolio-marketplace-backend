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
  const email = `test-listings-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

let sellerA;
let sellerB;
let buyer;
let categoryId;
const createdListingIds = [];
const createdUserIds = [];

before(async () => {
  sellerA = await createTestUser('seller-a', 'seller');
  sellerB = await createTestUser('seller-b', 'seller');
  buyer = await createTestUser('buyer', 'buyer');
  createdUserIds.push(sellerA.id, sellerB.id, buyer.id);

  const { data: category, error } = await admin
    .from('categories')
    .insert({ name: 'Test Category', slug: `test-category-${Date.now()}` })
    .select()
    .single();
  if (error) throw error;
  categoryId = category.id;
});

after(async () => {
  // Deleting the listing row cascades the listing_images rows, but not the
  // underlying storage objects -- those have to be removed separately or
  // every test run leaves orphaned files in the bucket.
  for (const listingId of createdListingIds) {
    const { data: files } = await admin.storage.from('listing-images').list(listingId, { limit: 1000 });
    if (files && files.length > 0) {
      await admin.storage.from('listing-images').remove(files.map((f) => `${listingId}/${f.name}`));
    }
  }

  if (createdListingIds.length > 0) {
    await admin.from('listings').delete().in('id', createdListingIds);
  }
  if (categoryId) {
    await admin.from('categories').delete().eq('id', categoryId);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

test('unauthenticated request is rejected with 401', async () => {
  const res = await request(app).get('/api/listings/mine');
  assert.equal(res.status, 401);
});

test('buyer role is rejected with 403', async () => {
  const res = await request(app).get('/api/listings/mine').set('Authorization', `Bearer ${buyer.token}`);
  assert.equal(res.status, 403);
});

test('seller can create a listing owned by themselves', async () => {
  const res = await request(app).post('/api/listings').set('Authorization', `Bearer ${sellerA.token}`).send({
    title: 'Test Vintage Jacket',
    description: 'A test listing',
    price: 19.99,
    condition: 'new',
    stock: 5,
    category_id: categoryId,
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.listing.seller_id, sellerA.id);
  assert.equal(res.body.listing.title, 'Test Vintage Jacket');
  assert.equal(res.body.listing.status, 'draft');
  createdListingIds.push(res.body.listing.id);
});

test('seller sees their own listing in GET /mine', async () => {
  const res = await request(app).get('/api/listings/mine').set('Authorization', `Bearer ${sellerA.token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.listings.some((l) => l.id === createdListingIds[0]));
});

test('a different seller does not see it in their own GET /mine', async () => {
  const res = await request(app).get('/api/listings/mine').set('Authorization', `Bearer ${sellerB.token}`);
  assert.equal(res.status, 200);
  assert.ok(!res.body.listings.some((l) => l.id === createdListingIds[0]));
});

test('seller can update their own listing', async () => {
  const res = await request(app)
    .patch(`/api/listings/${createdListingIds[0]}`)
    .set('Authorization', `Bearer ${sellerA.token}`)
    .send({ price: 24.99, status: 'active' });

  assert.equal(res.status, 200);
  assert.equal(Number(res.body.listing.price), 24.99);
  assert.equal(res.body.listing.status, 'active');
});

test('seller cannot blank out their own listing\'s title via PATCH', async () => {
  const res = await request(app)
    .patch(`/api/listings/${createdListingIds[0]}`)
    .set('Authorization', `Bearer ${sellerA.token}`)
    .send({ title: '' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'title cannot be empty');

  const { data: unchanged } = await admin.from('listings').select('title').eq('id', createdListingIds[0]).single();
  assert.equal(unchanged.title, 'Test Vintage Jacket', 'title must be untouched after the rejected update');
});

test('a different seller gets 403 updating a listing they do not own', async () => {
  const res = await request(app)
    .patch(`/api/listings/${createdListingIds[0]}`)
    .set('Authorization', `Bearer ${sellerB.token}`)
    .send({ price: 1 });
  assert.equal(res.status, 403);
});

test('a different seller gets 403 deleting a listing they do not own', async () => {
  const res = await request(app)
    .delete(`/api/listings/${createdListingIds[0]}`)
    .set('Authorization', `Bearer ${sellerB.token}`);
  assert.equal(res.status, 403);
});

test('a different seller gets 403 uploading images to a listing they do not own', async () => {
  const res = await request(app)
    .post(`/api/listings/${createdListingIds[0]}/images`)
    .set('Authorization', `Bearer ${sellerB.token}`)
    .attach('images', Buffer.from('not a real image'), 'fake.png');
  assert.equal(res.status, 403);
});

test('a nonexistent listing id returns 404, not 403', async () => {
  const res = await request(app)
    .patch('/api/listings/00000000-0000-0000-0000-000000000000')
    .set('Authorization', `Bearer ${sellerA.token}`)
    .send({ price: 1 });
  assert.equal(res.status, 404);
});

test('image upload works end to end and the image is publicly reachable', async () => {
  // 1x1 transparent PNG
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  const res = await request(app)
    .post(`/api/listings/${createdListingIds[0]}/images`)
    .set('Authorization', `Bearer ${sellerA.token}`)
    .attach('images', pngBuffer, 'test.png');

  assert.equal(res.status, 201);
  assert.equal(res.body.images.length, 1);
  assert.equal(res.body.images[0].listing_id, createdListingIds[0]);
  assert.ok(res.body.images[0].image_url.includes('listing-images'));

  const imgRes = await fetch(res.body.images[0].image_url);
  assert.equal(imgRes.status, 200);

  const { data: rows } = await admin.from('listing_images').select('*').eq('listing_id', createdListingIds[0]);
  assert.equal(rows.length, 1);
});

test('GET /api/listings/:id includes the full ordered image set', async () => {
  const res = await request(app).get(`/api/listings/${createdListingIds[0]}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.listing.images));
  assert.equal(res.body.listing.images.length, 1);
  assert.ok(res.body.listing.images[0].url.includes('listing-images'));
  assert.equal(res.body.listing.images[0].sort_order, 0);
});

test('GET /api/listings includes primary_image_url for a listing with images', async () => {
  const res = await request(app).get('/api/listings').query({ category_id: categoryId });
  assert.equal(res.status, 200);
  const found = res.body.listings.find((l) => l.id === createdListingIds[0]);
  assert.ok(found, 'listing should appear in browse results');
  assert.ok(typeof found.primary_image_url === 'string' && found.primary_image_url.includes('listing-images'));
});

let secondImageId;
let secondImageUrl;

test('uploading a second image brings the listing to 2 images', async () => {
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const res = await request(app)
    .post(`/api/listings/${createdListingIds[0]}/images`)
    .set('Authorization', `Bearer ${sellerA.token}`)
    .attach('images', pngBuffer, 'second.png');
  assert.equal(res.status, 201);
  secondImageId = res.body.images[0].id;
  secondImageUrl = res.body.images[0].image_url;

  const { data: rows } = await admin.from('listing_images').select('id').eq('listing_id', createdListingIds[0]);
  assert.equal(rows.length, 2);
});

test('a different seller gets 403 deleting an image on a listing they do not own', async () => {
  const res = await request(app)
    .delete(`/api/listings/${createdListingIds[0]}/images/${secondImageId}`)
    .set('Authorization', `Bearer ${sellerB.token}`);
  assert.equal(res.status, 403);
});

test('deleting a nonexistent image id on an owned listing returns 404', async () => {
  const res = await request(app)
    .delete(`/api/listings/${createdListingIds[0]}/images/00000000-0000-0000-0000-000000000000`)
    .set('Authorization', `Bearer ${sellerA.token}`);
  assert.equal(res.status, 404);
});

test('DELETE /api/listings/:id/images/:imageId removes the image from the DB, storage, and the API', async () => {
  const res = await request(app)
    .delete(`/api/listings/${createdListingIds[0]}/images/${secondImageId}`)
    .set('Authorization', `Bearer ${sellerA.token}`);
  assert.equal(res.status, 204);

  // Gone from the database.
  const { data: row } = await admin.from('listing_images').select('id').eq('id', secondImageId).maybeSingle();
  assert.equal(row, null, 'listing_images row should actually be deleted');

  // Gone from the storage bucket -- the public URL no longer resolves.
  const imgRes = await fetch(secondImageUrl);
  assert.equal(imgRes.status, 400, 'Supabase storage returns 400 for a missing object on a public bucket');

  // Gone from the real API response, and the OTHER image is untouched.
  const detailRes = await request(app).get(`/api/listings/${createdListingIds[0]}`);
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.listing.images.length, 1);
  assert.ok(!detailRes.body.listing.images.some((img) => img.id === secondImageId));
});

test('GET /api/listings/mine returns primary_image_url for a listing with photos', async () => {
  const res = await request(app).get('/api/listings/mine').set('Authorization', `Bearer ${sellerA.token}`);
  assert.equal(res.status, 200);
  const found = res.body.listings.find((l) => l.id === createdListingIds[0]);
  assert.ok(found, 'listing should appear in the seller\'s own list');
  assert.ok(
    typeof found.primary_image_url === 'string' && found.primary_image_url.includes('listing-images'),
    'primary_image_url should be a real listing-images URL, not null/placeholder',
  );
});

test('non-image files are rejected with 400', async () => {
  const res = await request(app)
    .post(`/api/listings/${createdListingIds[0]}/images`)
    .set('Authorization', `Bearer ${sellerA.token}`)
    .attach('images', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
  assert.equal(res.status, 400);
});

test('dashboard returns aggregated seller data', async () => {
  const res = await request(app).get('/api/listings/mine/dashboard').set('Authorization', `Bearer ${sellerA.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.total_active_listings, 1);
  assert.equal(typeof res.body.total_sold, 'number');
  assert.equal(res.body.total_stock, 5);
  assert.ok(Array.isArray(res.body.recent_order_items));
});

test('seller can soft-delete their own listing (status becomes removed, row still exists)', async () => {
  const res = await request(app)
    .delete(`/api/listings/${createdListingIds[0]}`)
    .set('Authorization', `Bearer ${sellerA.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.listing.status, 'removed');

  const { data: stillExists } = await admin
    .from('listings')
    .select('id')
    .eq('id', createdListingIds[0])
    .maybeSingle();
  assert.ok(stillExists, 'listing row should still exist after soft delete');
});

test('dashboard no longer counts the removed listing as active', async () => {
  const res = await request(app).get('/api/listings/mine/dashboard').set('Authorization', `Bearer ${sellerA.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.total_active_listings, 0);
});
