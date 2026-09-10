const supabase = require('../lib/db');

async function getOrCreatePreferences(userId) {
  const { data: existing, error: fetchError } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError) return { data: null, error: fetchError };
  if (existing) return { data: existing, error: null };

  const { data: created, error: createError } = await supabase
    .from('notification_preferences')
    .insert({ user_id: userId })
    .select()
    .single();

  return { data: created, error: createError };
}

const UPDATABLE_FIELDS = ['email_order_updates', 'email_marketing'];

async function updatePreferences(userId, fields) {
  const { data: current, error: getError } = await getOrCreatePreferences(userId);
  if (getError) return { data: null, error: getError };

  const updates = {};
  for (const field of UPDATABLE_FIELDS) {
    if (fields[field] !== undefined) {
      updates[field] = fields[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return { data: current, error: null };
  }

  const { data, error } = await supabase
    .from('notification_preferences')
    .update(updates)
    .eq('id', current.id)
    .select()
    .single();
  return { data, error };
}

module.exports = { getOrCreatePreferences, updatePreferences };
