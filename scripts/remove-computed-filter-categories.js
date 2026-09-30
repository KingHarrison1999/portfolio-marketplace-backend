// One-off follow-up to scripts/seed-category-taxonomy.js: New Arrivals and
// Secondhand are being converted from static category branches into
// computed filters (see services/listingsService.js's `collection` param
// on searchListings -- 'new-arrivals' / 'secondhand') instead of having
// their own Clothing/Shoes/Bags/Accessories subtree. This deletes that now-
// unneeded subtree entirely: the main category row, its 4 subcategories,
// and their item-type children (25 rows each, 50 total).
//
// Refuses to run if any listing still references one of these categories --
// they should all be empty branches (Men/Women/Junior hold the real
// catalog), but this checks rather than assuming.
//
// Not part of the app's runtime -- run manually, once, against the
// PORTFOLIO project's Supabase database (see the guard below).
//
// Usage:
//   node scripts/remove-computed-filter-categories.js
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (same as the
// running app). Safe to re-run: if the categories are already gone, it's a
// no-op.

require('dotenv').config({ quiet: true });

// --- Safety guard -----------------------------------------------------
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

const BRANCH_SLUGS = ['new-arrivals', 'secondhand'];

async function main() {
  console.log(`Removing computed-filter category branches against ${process.env.SUPABASE_URL}`);

  const { data: mains, error: mainsError } = await supabase
    .from('categories')
    .select('id, name, slug')
    .in('slug', BRANCH_SLUGS);
  if (mainsError) throw mainsError;

  if (mains.length === 0) {
    console.log('\nNo New Arrivals / Secondhand category rows found -- already cleaned up.');
    return;
  }

  const { data: subs, error: subsError } = await supabase
    .from('categories')
    .select('id, name, slug')
    .in(
      'parent_id',
      mains.map((m) => m.id),
    );
  if (subsError) throw subsError;

  const { data: items, error: itemsError } = await supabase
    .from('categories')
    .select('id, name, slug')
    .in(
      'parent_id',
      subs.map((s) => s.id),
    );
  if (itemsError) throw itemsError;

  const allIds = [...mains, ...subs, ...items].map((c) => c.id);
  console.log(`\nFound ${mains.length} main + ${subs.length} sub + ${items.length} item-type rows to remove.`);

  const { data: referencingListings, error: refError } = await supabase
    .from('listings')
    .select('id, title')
    .in('category_id', allIds);
  if (refError) throw refError;

  if (referencingListings.length > 0) {
    console.log('\nRefusing to delete -- these listings still reference a category being removed:');
    for (const l of referencingListings) console.log(`  - "${l.title}" (${l.id})`);
    console.log('\nReassign them first, then re-run this script.');
    process.exitCode = 1;
    return;
  }

  // Children first (item types), then subcategories, then the main rows --
  // parent_id is ON DELETE SET NULL so order isn't required for FK safety,
  // but doing it leaf-first avoids ever leaving a temporarily-orphaned row.
  if (items.length > 0) {
    const { error } = await supabase
      .from('categories')
      .delete()
      .in(
        'id',
        items.map((c) => c.id),
      );
    if (error) throw error;
    console.log(`\n- deleted ${items.length} item-type categories`);
  }

  if (subs.length > 0) {
    const { error } = await supabase
      .from('categories')
      .delete()
      .in(
        'id',
        subs.map((c) => c.id),
      );
    if (error) throw error;
    console.log(`- deleted ${subs.length} subcategories`);
  }

  const { error: mainDeleteError } = await supabase
    .from('categories')
    .delete()
    .in(
      'id',
      mains.map((c) => c.id),
    );
  if (mainDeleteError) throw mainDeleteError;
  console.log(`- deleted ${mains.length} main categories: ${mains.map((c) => c.name).join(', ')}`);

  console.log('\nDone.');
}

main()
  .then(() => process.exit())
  .catch((err) => {
    console.error('\nScript failed:', err.message || err);
    process.exit(1);
  });
