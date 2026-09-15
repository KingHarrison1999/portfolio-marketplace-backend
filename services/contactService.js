const emailProvider = require('../lib/emailProvider');

const BUSINESS_EMAIL = 'kingharrison1999@gmail.com';

// Message content is free-text from an anonymous visitor -- escape before
// interpolating into the HTML email body.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function sendContactMessage({ name, email, message }) {
  return emailProvider.sendEmail({
    to: BUSINESS_EMAIL,
    subject: `Contact form message from ${name}`,
    text: `From: ${name} <${email}>\n\n${message}`,
    html: `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
    replyTo: email,
  });
}

module.exports = { sendContactMessage };
