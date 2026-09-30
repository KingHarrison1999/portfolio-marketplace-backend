// Read-only report: prints every listing's title, subcategory, and
// condition, straight from the database via the same client/service layer
// the app itself uses (lib/db.js) -- not raw SQL, same approach as the
// seed scripts' own verification steps.
//
// Not part of the app's runtime. Read-only -- makes no writes.
//
// Usage:
//   node scripts/list-listings-report.js
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (same as the
// running app).

require('dotenv').config({ quiet: true });

// --- Safety guard -----------------------------------------------------
// Same guard as the seed scripts -- this account also has access to the
// REAL client's production Supabase project (ref ctgarodvlfmtpcxrmhnf).
// Refuse to run against anything but the Portfolio org's "Marketplace"
// project (ref wtjhtsjvbmkanjvgnxvs), rather than trusting whatever .env
// happens to be loaded.
const PORTFOLIO_PROJECT_REF = 'wtjhtsjvbmkanjvgnxvs';
const REAL_CLIENT_PROJECT_REF = 'ctgarodvlfmtpcxrmhnf';

function assertCorrectProject() {
  const url = process.env.SUPABASE_URL || '';
  if (url.includes(REAL_CLIENT_PROJECT_REF)) {
    throw new Error(
      `Refusing to run: SUPABASE_URL points at the REAL CLIENT project (${REAL_CLIENT_PROJECT_REF}), ` +
        'not the Portfolio demo project. Check .env.',
    );
  }
  if (!url.includes(PORTFOLIO_PROJECT_REF)) {
    throw new Error(
      `Refusing to run: SUPABASE_URL does not look like the Portfolio project (expected ref ` +
        `${PORTFOLIO_PROJECT_REF}). Got: "${url}". Check .env before running this against an ` +
        'unknown database.',
    );
  }
}

assertCorrectProject();

const supabase = require('../lib/db');

// Given the 3-level taxonomy (Main category -> Subcategory -> Item type),
// resolve whichever category a listing is actually assigned to up to the
// "Subcategory" tier specifically:
// - depth 2 (a leaf "Item type", has a parent that itself has a parent):
//   subcategory is its PARENT.
// - depth 1 (already a "Subcategory", has a parent but that parent is
//   root): subcategory is itself.
// - depth 0 (a root "Main category", no parent -- listings shouldn't
//   normally be assigned this high, but handled rather than crashing):
//   no subcategory to report.
function resolveSubcategoryName(categoryId, categoriesById) {
  if (!categoryId) return '(no category)';
  const cat = categoriesById.get(categoryId);
  if (!cat) return '(unknown category)';

  if (!cat.parent_id) {
    return '(assigned to a top-level category, not a subcategory)';
  }
  const parent = categoriesById.get(cat.parent_id);
  if (!parent || !parent.parent_id) {
    // cat's parent is root (or missing) -> cat itself is the Subcategory tier.
    return cat.name;
  }
  // cat has a grandparent -> cat is the leaf Item type, its parent is the Subcategory.
  return parent.name;
}

async function main() {
  const [{ data: categories, error: catError }, { data: listings, error: listError }] = await Promise.all([
    supabase.from('categories').select('id, name, parent_id'),
    supabase.from('listings').select('title, condition, category_id, status').order('title', { ascending: true }),
  ]);

  if (catError) throw catError;
  if (listError) throw listError;

  const categoriesById = new Map(categories.map((c) => [c.id, c]));

  const rows = listings.map((l) => ({
    title: l.title,
    subcategory: resolveSubcategoryName(l.category_id, categoriesById),
    condition: l.condition || '(none)',
    status: l.status,
  }));

  // Column widths for a clean fixed-width table.
  const w1 = Math.max(5, ...rows.map((r) => r.title.length));
  const w2 = Math.max(11, ...rows.map((r) => r.subcategory.length));
  const w3 = Math.max(9, ...rows.map((r) => r.condition.length));

  const pad = (s, w) => String(s).padEnd(w, ' ');

  console.log(`Total listings: ${rows.length}\n`);
  console.log(`${pad('Title', w1)}  ${pad('Subcategory', w2)}  ${pad('Condition', w3)}  Status`);
  console.log(`${'-'.repeat(w1)}  ${'-'.repeat(w2)}  ${'-'.repeat(w3)}  ------`);
  for (const r of rows) {
    console.log(`${pad(r.title, w1)}  ${pad(r.subcategory, w2)}  ${pad(r.condition, w3)}  ${r.status}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nReport failed:', err.message || err);
    process.exit(1);
  });
