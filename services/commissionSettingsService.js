const supabase = require('../lib/db');

async function getSettings() {
  const { data, error } = await supabase.from('commission_settings').select('*').limit(1).maybeSingle();
  return { data, error };
}

const UPDATABLE_FIELDS = ['flat_rate', 'business_rate', 'charity_rate'];

async function updateSettings(fields) {
  const { data: current, error: fetchError } = await getSettings();
  if (fetchError) return { data: null, error: fetchError };
  if (!current) return { data: null, error: new Error('No commission settings row exists') };

  const updates = { updated_at: new Date().toISOString() };
  for (const field of UPDATABLE_FIELDS) {
    if (fields[field] !== undefined) {
      updates[field] = fields[field];
    }
  }

  const { data, error } = await supabase
    .from('commission_settings')
    .update(updates)
    .eq('id', current.id)
    .select()
    .single();
  return { data, error };
}

module.exports = { getSettings, updateSettings };
