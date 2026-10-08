// One-off follow-up to scripts/seed-category-taxonomy.js: that script force-
// fit dresses, blouses/tops and the mini skirt into Women > Clothing >
// Shirts because the original taxonomy spec had no Dresses/Skirts/Trousers
// bucket. This adds four more item types under Women > Clothing only
// (Dresses, Skirts, Trousers, Jumpers & Knitwear) and moves the listings
// that were force-fit into their correct new category.
//
// Scoped to Women's Clothing specifically, not added to Men/New
// Arrivals/Secondhand -- those weren't asked for and still don't have a
// Dresses/Skirts/Trousers gap flagged against them.
//
// Not part of the app's runtime -- run manually, once, against the
// PORTFOLIO project's Supabase database (see the guard below). Uses the
// same supabase-js client and service layer (lib/db.js, categoriesService)
// the app itself uses.
//
// Usage:
//   node scripts/add-womens-clothing-item-types.js
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (same as the
// running app). Safe to re-run: categories are matched by slug before
// creating, so a second run tops up rather than duplicating.

require('dotenv').config({ quiet: true });

// --- Safety guard -----------------------------------------------------
// This account also has access to the REAL client's production Supabase
// project (ref ctgarodvlfmtpcxrmhnf) -- the one the live production site
// actually runs on. This script must only ever run against the Portfolio
// org's "Marketplace" project (ref wtjhtsjvbmkanjvgnxvs). Refuse to do
// anything otherwise, rather than trusting whatever .env happens to be
// loaded.
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
const categoriesService = require('../services/categoriesService');

const NEW_ITEM_TYPES = ['Dresses', 'Skirts', 'Trousers', 'Jumpers & Knitwear'];

const LISTING_REASSIGNMENTS = [
  { title: 'Floral Midi Tea Dress', item: 'Dresses' },
  { title: 'Emerald Velvet Evening Dress', item: 'Dresses' },
  { title: 'Polka Dot Shirt Dress', item: 'Dresses' },
  { title: 'Pleated Tartan Mini Skirt', item: 'Skirts' },
  { title: 'Wide-Leg Corduroy Trousers', item: 'Trousers' },
];

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function findCategoryBySlug(slug) {
  const { data, error } = await supabase.from('categories').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertCategory(name, slug, parentId) {
  const existing = await findCategoryBySlug(slug);
  if (existing) {
    if (existing.parent_id !== parentId) {
      const { data, error } = await supabase
        .from('categories')
        .update({ parent_id: parentId })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      console.log(`  ~ "${name}" (${slug}) parent_id was stale, fixed -> ${data.id}`);
      return data;
    }
    console.log(`  = "${name}" (${slug}) already exists, reusing (${existing.id})`);
    return existing;
  }
  const { data, error } = await categoriesService.createCategory({ name, slug, parent_id: parentId });
  if (error) throw error;
  console.log(`  + created "${name}" (${slug}) -> ${data.id}`);
  return data;
}

async function reassignListing(title, categoryId) {
  const { data: listing, error: findError } = await supabase
    .from('listings')
    .select('id, title')
    .eq('title', title)
    .maybeSingle();
  if (findError) throw findError;
  if (!listing) {
    console.log(`  ! listing "${title}" not found, skipping`);
    return;
  }

  const { error: updateError } = await supabase
    .from('listings')
    .update({ category_id: categoryId, updated_at: new Date().toISOString() })
    .eq('id', listing.id);
  if (updateError) throw updateError;

  console.log(`  "${title}" -> reassigned`);
}

async function main() {
  console.log(`Adding Women's Clothing item types against ${process.env.SUPABASE_URL}`);

  const womensClothing = await findCategoryBySlug('women-clothing');
  if (!womensClothing) {
    throw new Error('women-clothing category not found -- run scripts/seed-category-taxonomy.js first');
  }

  console.log("\nCreating new Women > Clothing item types...");
  const itemCategories = {};
  for (const name of NEW_ITEM_TYPES) {
    const slug = `women-clothing-${slugify(name)}`;
    itemCategories[name] = await upsertCategory(name, slug, womensClothing.id);
  }

  console.log('\nReassigning listings to their correct new category...');
  for (const { title, item } of LISTING_REASSIGNMENTS) {
    await reassignListing(title, itemCategories[item].id);
  }

  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nScript failed:', err.message || err);
    process.exit(1);
  });
