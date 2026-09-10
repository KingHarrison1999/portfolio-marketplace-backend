const supabase = require('../lib/db');

async function getAllCategories() {
  const { data, error } = await supabase.from('categories').select('*').order('name', { ascending: true });
  return { data, error };
}

async function getCategoryById(id) {
  const { data, error } = await supabase.from('categories').select('*').eq('id', id).maybeSingle();
  return { data, error };
}

async function createCategory(fields) {
  const { name, slug, parent_id: parentId } = fields;
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, slug, parent_id: parentId ?? null })
    .select()
    .single();
  return { data, error };
}

const UPDATABLE_FIELDS = ['name', 'slug', 'parent_id'];

async function updateCategory(id, fields) {
  const updates = {};
  for (const field of UPDATABLE_FIELDS) {
    if (fields[field] !== undefined) {
      updates[field] = fields[field];
    }
  }
  const { data, error } = await supabase.from('categories').update(updates).eq('id', id).select().single();
  return { data, error };
}

async function countActiveListings(categoryId) {
  const { count, error } = await supabase
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId)
    .eq('status', 'active');
  return { count, error };
}

async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  return { error };
}

module.exports = {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  countActiveListings,
  deleteCategory,
};
