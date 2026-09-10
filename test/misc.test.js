require('dotenv').config({ quiet: true });

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const request = require('supertest');

const app = require('../app');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const createdSubscriberEmails = [];

after(async () => {
  if (createdSubscriberEmails.length > 0) {
    await admin.from('newsletter_subscribers').delete().in('email', createdSubscriberEmails);
  }
});

// --- Newsletter signup ---------------------------------------------------

test('newsletter: rejects a missing email', async () => {
  const res = await request(app).post('/api/newsletter/subscribe').send({});
  assert.equal(res.status, 400);
});

test('newsletter: rejects an invalid email', async () => {
  const res = await request(app).post('/api/newsletter/subscribe').send({ email: 'not-an-email' });
  assert.equal(res.status, 400);
});

test('newsletter: a valid new email really subscribes', async () => {
  const email = `test-newsletter-${Date.now()}@example.com`;
  createdSubscriberEmails.push(email);

  const res = await request(app).post('/api/newsletter/subscribe').send({ email });
  assert.equal(res.status, 201);

  const { data } = await admin.from('newsletter_subscribers').select('email').eq('email', email).single();
  assert.equal(data.email, email, 'the row must really exist in the database');
});

test('newsletter: subscribing the same email twice is an idempotent success, not an error', async () => {
  const email = `test-newsletter-dup-${Date.now()}@example.com`;
  createdSubscriberEmails.push(email);

  const firstRes = await request(app).post('/api/newsletter/subscribe').send({ email });
  assert.equal(firstRes.status, 201);

  const secondRes = await request(app).post('/api/newsletter/subscribe').send({ email });
  assert.equal(secondRes.status, 200);
  assert.equal(secondRes.body.status, 'already_subscribed');

  const { data } = await admin.from('newsletter_subscribers').select('id').eq('email', email);
  assert.equal(data.length, 1, 'must not have created a duplicate row');
});

// --- Contact form ---------------------------------------------------------

test('contact: rejects missing fields', async () => {
  const res = await request(app).post('/api/contact').send({ name: 'Test' });
  assert.equal(res.status, 400);
});

test('contact: rejects an invalid email', async () => {
  const res = await request(app).post('/api/contact').send({ name: 'Test', email: 'not-an-email', message: 'Hello' });
  assert.equal(res.status, 400);
});

test('contact: a valid submission really sends an email to the business inbox', async () => {
  // Gmail "+" aliasing -- delivers to the real kingharrison1999@gmail.com
  // inbox, so Resend accepts it as a real reply-to address (unlike
  // @example.com, which Resend's own test-mode restrictions reject as a
  // "to" address -- this is only ever used as reply_to here, but a
  // deliverable address keeps this test unambiguous either way).
  const submitterEmail = `kingharrison1999+contacttest${Date.now()}@gmail.com`;

  const res = await request(app).post('/api/contact').send({
    name: 'QA Test Sender',
    email: submitterEmail,
    message: 'This is a real automated test of the contact form endpoint.',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'sent');
});
