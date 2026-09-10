const supabase = require('../lib/db');
const emailProvider = require('../lib/emailProvider');
const notificationPreferencesService = require('./notificationPreferencesService');

async function getEmailAndPreferences(userId) {
  const [{ data: authData, error: authError }, { data: prefs, error: prefsError }] = await Promise.all([
    supabase.auth.admin.getUserById(userId),
    notificationPreferencesService.getOrCreatePreferences(userId),
  ]);

  if (authError || prefsError) {
    return { error: authError || prefsError };
  }

  return { email: authData?.user?.email, prefs };
}

// Both events below are "order update" notifications -- notification_
// preferences only has email_order_updates and email_marketing, no
// separate flag for e.g. seller sales alerts, so both check the same
// field.

async function sendOrderReceivedEmail(order) {
  const { email, prefs, error } = await getEmailAndPreferences(order.buyer_id);
  if (error) return { sent: false, reason: 'failed to load recipient' };
  if (!email) return { sent: false, reason: 'no email on file' };
  if (!prefs.email_order_updates) return { sent: false, reason: 'opted_out' };

  return emailProvider.sendEmail({
    to: email,
    subject: `Order received -- #${order.id}`,
    html: `<p>Thanks for your order! We've received your order <strong>#${order.id}</strong> for £${order.total}. We'll let you know once it's confirmed.</p>`,
    text: `Thanks for your order! We've received your order #${order.id} for £${order.total}. We'll let you know once it's confirmed.`,
  });
}

// Checkout splits a cart into one order per seller, so every order
// belongs entirely to a single seller -- order_items[0].seller_id is
// that seller for the whole order, not just one line of it.
async function sendNewOrderEmailToSeller(order) {
  const sellerId = order.order_items?.[0]?.seller_id;
  if (!sellerId) return { sent: false, reason: 'no seller on order' };

  const { email, prefs, error } = await getEmailAndPreferences(sellerId);
  if (error) return { sent: false, reason: 'failed to load recipient' };
  if (!email) return { sent: false, reason: 'no email on file' };
  if (!prefs.email_order_updates) return { sent: false, reason: 'opted_out' };

  return emailProvider.sendEmail({
    to: email,
    subject: `New order -- #${order.id}`,
    html: `<p>You have a new order <strong>#${order.id}</strong> totalling £${order.total}.</p>`,
    text: `You have a new order #${order.id} totalling £${order.total}.`,
  });
}

module.exports = { sendOrderReceivedEmail, sendNewOrderEmailToSeller };
