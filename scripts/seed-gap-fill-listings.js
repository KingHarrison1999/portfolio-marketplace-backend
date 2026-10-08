// One-off follow-up to scripts/seed-category-taxonomy.js: after the 3-level
// taxonomy went in, Men's Shoes and Men's Bags had zero listings. Adds a
// placeholder listing for each, using the fake sellers from
// scripts/seed-vintage-fashion.js. Both are created as 'draft': their
// picsum placeholder photos are random landscapes, not the items, so they
// stay hidden until real photos exist. (This script used to add four
// Junior listings too; the Junior branch and those listings were removed
// by scripts/clean-demo-catalog.js.)
//
// Not part of the app's runtime -- run manually, once, against the
// PORTFOLIO project's Supabase database (see the guard below). Uses the
// same supabase-js client and service layer (lib/db.js, listingsService)
// the app itself uses.
//
// Usage:
//   node scripts/seed-gap-fill-listings.js
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (same as the
// running app). Safe to re-run: skips a listing if that exact seller
// already has one with the same title.

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
const listingsService = require('../services/listingsService');

// Existing fake sellers from scripts/seed-vintage-fashion.js, matched by
// email -- this script only reuses them, it doesn't create new ones.
const SELLER_EMAILS = {
  isla: 'isla.bennett.demo@example.com',
  marcus: 'marcus.whitfield.demo@example.com',
  priya: 'priya.anand.demo@example.com',
  sam: 'sam.oconnor.demo@example.com',
  freya: 'freya.nakamura.demo@example.com',
};

const LISTINGS = [
  {
    categorySlug: 'men-shoes-sneakers',
    seller: 'marcus',
    title: 'Navy Suede Retro Trainers',
    description: 'Low-top trainers in navy suede with a gum sole. Light scuffing on the toe, plenty of wear left.',
    price: 32,
    condition: 'used',
    imageSeed: 'vf-mens-shoes-1',
    status: 'draft',
  },
  {
    categorySlug: 'men-bags-backpacks',
    seller: 'marcus',
    title: 'Olive Canvas Weekend Backpack',
    description: 'Olive canvas backpack with leather trim, one main compartment plus a front pocket. Barely used, no marks.',
    price: 30,
    condition: 'like_new',
    imageSeed: 'vf-mens-bag-1',
    status: 'draft',
  },
];

function placeholderImageUrl(seed) {
  return `https://picsum.photos/seed/${seed}/800/600`;
}

async function findCategoryBySlug(slug) {
  const { data, error } = await supabase.from('categories').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
}

async function findSellerProfileByEmail(email) {
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const authUser = list.users.find((u) => u.email === email);
  if (!authUser) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();
  if (profileError) throw profileError;
  return profile;
}

async function main() {
  console.log(`Filling category gaps against ${process.env.SUPABASE_URL}`);

  console.log('\nLoading existing sellers...');
  const sellerByKey = {};
  for (const [key, email] of Object.entries(SELLER_EMAILS)) {
    const profile = await findSellerProfileByEmail(email);
    if (!profile) throw new Error(`Seller "${key}" (${email}) not found -- run scripts/seed-vintage-fashion.js first`);
    sellerByKey[key] = profile;
  }

  console.log('\nCreating gap-fill listings...');
  let created = 0;
  for (const item of LISTINGS) {
    const category = await findCategoryBySlug(item.categorySlug);
    if (!category) throw new Error(`Category "${item.categorySlug}" not found`);
    const seller = sellerByKey[item.seller];

    const { data: existing, error: existingError } = await supabase
      .from('listings')
      .select('id')
      .eq('seller_id', seller.id)
      .eq('title', item.title)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      console.log(`  = "${item.title}" already exists for ${seller.display_name}, skipping`);
      continue;
    }

    const { data: listing, error: listingError } = await listingsService.createListing(seller.id, {
      title: item.title,
      description: item.description,
      price: item.price,
      condition: item.condition,
      stock: 1,
      category_id: category.id,
    });
    if (listingError) throw listingError;

    // status: 'draft' = placeholder photo only, keep it hidden until a real one exists.
    if (item.status !== 'draft') {
      const { error: activateError } = await supabase
        .from('listings')
        .update({ status: 'active' })
        .eq('id', listing.id);
      if (activateError) throw activateError;
    }

    const { error: imageError } = await supabase
      .from('listing_images')
      .insert({ listing_id: listing.id, image_url: placeholderImageUrl(item.imageSeed), sort_order: 0 });
    if (imageError) throw imageError;

    console.log(`  + "${item.title}" (£${item.price}, ${item.condition}${item.status === 'draft' ? ', draft' : ''}) by ${seller.display_name} in ${category.name}`);
    created += 1;
  }

  console.log(`\nDone. ${created} new listing(s) created.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nScript failed:', err.message || err);
    process.exit(1);
  });
