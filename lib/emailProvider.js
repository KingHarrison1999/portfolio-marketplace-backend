// Transactional email via Resend.
//
// A real Resend account, API key, and verified sending domain
// (thecollectorsmarket.co.uk) are configured (RESEND_API_KEY,
// RESEND_FROM_EMAIL). sendEmail() still no-ops (returns
// { sent: false, reason }) rather than throwing if either goes missing
// (e.g. a different environment without them set), so every caller keeps
// behaving correctly either way.

const { Resend } = require('resend');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;

const client = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!client) {
    return { sent: false, reason: 'RESEND_API_KEY is not configured' };
  }
  if (!RESEND_FROM_EMAIL) {
    return { sent: false, reason: 'RESEND_FROM_EMAIL is not configured' };
  }

  const { data, error } = await client.emails.send({
    from: RESEND_FROM_EMAIL,
    to: [to],
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    return { sent: false, reason: error.message };
  }

  return { sent: true, id: data.id };
}

module.exports = { sendEmail };
