const supabase = require('../lib/db');

async function resolveUser(req) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return null;
  }

  return { id: user.id, email: user.email, role: profile.role };
}

async function requireAuth(req, res, next) {
  const user = await resolveUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  req.user = user;
  next();
}

// Populates req.user when a valid Bearer token is present, but never
// rejects -- for routes that behave differently for authenticated callers
// (e.g. a listing owner viewing their own non-active listing) while still
// being reachable without a token.
async function optionalAuth(req, res, next) {
  req.user = await resolveUser(req);
  next();
}

module.exports = { requireAuth, optionalAuth };
