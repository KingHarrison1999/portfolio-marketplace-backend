const supabase = require('../lib/db');

async function getAllAdSpaces() {
  const { data, error } = await supabase.from('ad_spaces').select('*').order('created_at', { ascending: false });
  return { data, error };
}

async function getAdSpaceById(id) {
  const { data, error } = await supabase.from('ad_spaces').select('*').eq('id', id).maybeSingle();
  return { data, error };
}

async function createAdSpace(fields) {
  const {
    owner_id: ownerId,
    business_name: businessName,
    placement,
    image_url: imageUrl,
    click_through_url: clickThroughUrl,
    start_date: startDate,
    end_date: endDate,
    price,
  } = fields;

  const { data, error } = await supabase
    .from('ad_spaces')
    .insert({
      owner_id: ownerId ?? null,
      business_name: businessName ?? null,
      placement,
      image_url: imageUrl ?? null,
      click_through_url: clickThroughUrl ?? null,
      start_date: startDate,
      end_date: endDate ?? null,
      price: price ?? 0,
    })
    .select()
    .single();
  return { data, error };
}

const UPDATABLE_FIELDS = [
  'owner_id',
  'business_name',
  'placement',
  'image_url',
  'click_through_url',
  'start_date',
  'end_date',
  'price',
  'is_active',
];

async function updateAdSpace(id, fields) {
  const updates = { updated_at: new Date().toISOString() };
  for (const field of UPDATABLE_FIELDS) {
    if (fields[field] !== undefined) {
      updates[field] = fields[field];
    }
  }
  const { data, error } = await supabase.from('ad_spaces').update(updates).eq('id', id).select().single();
  return { data, error };
}

async function deactivateAdSpace(id) {
  const { data, error } = await supabase
    .from('ad_spaces')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

// Public read path -- active ad spaces for a given placement, "active"
// meaning is_active AND today falls within [start_date, end_date] (end_date
// null = open-ended). Only the fields a banner actually needs to render are
// selected; owner_id/price stay admin-only.
async function getActiveAdSpacesForPlacement(placement) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('ad_spaces')
    .select('id, business_name, placement, image_url, click_through_url')
    .eq('placement', placement)
    .eq('is_active', true)
    .lte('start_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('created_at', { ascending: false });
  return { data, error };
}

module.exports = {
  getAllAdSpaces,
  getAdSpaceById,
  createAdSpace,
  updateAdSpace,
  deactivateAdSpace,
  getActiveAdSpacesForPlacement,
};
