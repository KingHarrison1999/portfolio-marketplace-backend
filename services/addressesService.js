const supabase = require('../lib/db');

const UPDATABLE_FIELDS = ['line1', 'line2', 'city', 'postcode', 'country', 'is_default'];

async function getAddressesForUser(userId) {
  const { data, error } = await supabase
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('id', { ascending: true });
  return { data, error };
}

async function getAddressById(id) {
  const { data, error } = await supabase.from('addresses').select('*').eq('id', id).maybeSingle();
  return { data, error };
}

async function createAddress(userId, fields) {
  const { line1, line2, city, postcode, country, is_default: isDefault } = fields;

  const { data, error } = await supabase
    .from('addresses')
    .insert({
      user_id: userId,
      line1,
      line2,
      city,
      postcode,
      country,
      is_default: !!isDefault,
    })
    .select()
    .single();

  return { data, error };
}

async function updateAddress(id, fields) {
  const updates = {};
  for (const field of UPDATABLE_FIELDS) {
    if (fields[field] !== undefined) {
      updates[field] = fields[field];
    }
  }

  const { data, error } = await supabase.from('addresses').update(updates).eq('id', id).select().single();
  return { data, error };
}

async function deleteAddress(id) {
  const { error } = await supabase.from('addresses').delete().eq('id', id);
  return { error };
}

module.exports = { getAddressesForUser, getAddressById, createAddress, updateAddress, deleteAddress };
