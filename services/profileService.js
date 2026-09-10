const supabase = require('../lib/db');

async function getProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return { data, error };
}

const UPDATABLE_FIELDS = ['display_name', 'bio', 'avatar_url', 'commission_tier'];

async function updateProfile(userId, fields) {
  const updates = {};
  for (const field of UPDATABLE_FIELDS) {
    if (fields[field] !== undefined) {
      updates[field] = fields[field];
    }
  }

  // A self-service change to commission_tier always resets verification --
  // a previously-verified claim (e.g. "business") doesn't carry over to a
  // newly-declared one (e.g. "charity"), and re-declaring the same value
  // shouldn't let a seller dodge re-review either. Admin overrides go
  // through a separate path (adminUsersService.overrideCommissionTier) that
  // sets verified: true instead.
  if (fields.commission_tier !== undefined) {
    updates.commission_tier_verified = false;
  }

  const { data, error } = await supabase.from('profiles').update(updates).eq('id', userId).select().single();
  return { data, error };
}

// Real self-service account deletion is genuinely dangerous here: both
// listings.seller_id and order_items.seller_id reference profiles(id) with
// ON DELETE CASCADE (see cart_and_orders.sql), so deleting a seller's
// profile silently deletes their listings AND every order_item row that
// references them as seller -- including rows on orders that belong to a
// DIFFERENT buyer. That would destroy another user's real purchase record,
// not just the deleting user's own data. A buyer with no sales history has
// no such risk (orders.buyer_id cascades to only their own orders).
async function countSoldOrderItems(userId) {
  const { count, error } = await supabase
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', userId);
  return { count, error };
}

async function deleteAccount(userId) {
  return supabase.auth.admin.deleteUser(userId);
}

module.exports = { getProfile, updateProfile, countSoldOrderItems, deleteAccount };
