const supabase = require('../lib/db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Admin-only user picker (e.g. assigning an ad space's owner_id) -- not a
// general user directory. profiles has no email column (see
// 20260825112140_profiles_and_helpers.sql), so matching is by display_name,
// with an exact-id path for pre-filling an already-known owner_id.
async function searchUsers(search) {
  let query = supabase
    .from('profiles')
    .select('id, display_name, role, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (search) {
    query = UUID_RE.test(search) ? query.eq('id', search) : query.ilike('display_name', `%${search}%`);
  }

  const { data, error } = await query;
  return { data, error };
}

// Full user directory for the admin "Manage Users" page -- unlike
// searchUsers() above, this needs email (auth.users, not profiles) and
// suspension status, so it merges the profiles table with the GoTrue
// admin listUsers() API by id. perPage: 1000 is an unpaginated "get
// everything" call -- fine at this project's real scale, same
// no-pagination approach as every other admin list in this app
// (categories, ad spaces, dashboard counts).
async function getAllUsersDirectory() {
  const [profilesRes, authRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, role, created_at, commission_tier, commission_tier_verified')
      .order('created_at', { ascending: false }),
    supabase.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (profilesRes.error) return { data: null, error: profilesRes.error };
  if (authRes.error) return { data: null, error: authRes.error };

  const authById = new Map(authRes.data.users.map((u) => [u.id, u]));
  const now = Date.now();

  const directory = profilesRes.data.map((profile) => {
    const authUser = authById.get(profile.id);
    const bannedUntil = authUser?.banned_until ?? null;
    return {
      id: profile.id,
      display_name: profile.display_name,
      role: profile.role,
      created_at: profile.created_at,
      email: authUser?.email ?? null,
      is_suspended: !!(bannedUntil && new Date(bannedUntil).getTime() > now),
      commission_tier: profile.commission_tier,
      commission_tier_verified: profile.commission_tier_verified,
    };
  });

  return { data: directory, error: null };
}

// Suspension is a real Supabase Auth ban (auth.users.banned_until), not an
// invented status field -- there's no "suspended" concept anywhere in the
// schema otherwise. ban_duration has no "forever" value; GoTrue's own docs
// use a ~100-year duration as the idiomatic stand-in for permanent.
async function suspendUser(id) {
  const { data, error } = await supabase.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  return { data, error };
}

async function reactivateUser(id) {
  const { data, error } = await supabase.auth.admin.updateUserById(id, { ban_duration: 'none' });
  return { data, error };
}

const VALID_COMMISSION_TIERS = ['individual', 'business', 'charity'];

async function getSellerProfile(id) {
  const { data, error } = await supabase.from('profiles').select('id, role, commission_tier').eq('id', id).maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: { status: 404, message: 'User not found' } };
  if (data.role !== 'seller') return { data: null, error: { status: 400, message: 'Only sellers have a commission tier' } };
  return { data, error: null };
}

// Confirms the seller's CURRENT self-declared commission_tier is legitimate
// -- doesn't change the value, only its verified flag. Use
// overrideCommissionTier() to set a different tier (which is implicitly
// verified, since the admin is asserting it directly).
async function verifyCommissionTier(id) {
  const { data: profile, error: profileError } = await getSellerProfile(id);
  if (profileError) return { data: null, error: profileError };

  const { data, error } = await supabase
    .from('profiles')
    .update({ commission_tier_verified: true })
    .eq('id', profile.id)
    .select('id, commission_tier, commission_tier_verified')
    .single();
  return { data, error };
}

async function overrideCommissionTier(id, tier) {
  if (!VALID_COMMISSION_TIERS.includes(tier)) {
    return { data: null, error: { status: 400, message: `commission_tier must be one of: ${VALID_COMMISSION_TIERS.join(', ')}` } };
  }

  const { data: profile, error: profileError } = await getSellerProfile(id);
  if (profileError) return { data: null, error: profileError };

  const { data, error } = await supabase
    .from('profiles')
    .update({ commission_tier: tier, commission_tier_verified: true })
    .eq('id', profile.id)
    .select('id, commission_tier, commission_tier_verified')
    .single();
  return { data, error };
}

module.exports = {
  searchUsers,
  getAllUsersDirectory,
  suspendUser,
  reactivateUser,
  verifyCommissionTier,
  overrideCommissionTier,
};
