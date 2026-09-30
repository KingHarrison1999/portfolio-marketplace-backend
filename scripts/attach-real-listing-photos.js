// One-off: points each of the 18 listings originally created by
// scripts/seed-vintage-fashion.js at a real product photo, now that real
// photos exist in portfolio-demo-frontend/site/Images/ (replacing the
// picsum.photos placeholder each one was seeded with).
//
// Not part of the app's runtime -- run manually, once, against the
// PORTFOLIO project's Supabase database (see the guard below). Uses the
// same supabase-js client (lib/db.js) the app itself uses.
//
// Images are served from the frontend's own Images/ folder (no upload
// endpoint involved -- listing_images.image_url is a plain string column,
// same as how the picsum placeholders were stored). Stored as a
// root-relative path ("/Images/<file>"), not a bare relative one
// ("Images/<file>") -- primary_image_url gets rendered as an <img src>
// from several different page depths (root-level browse.html/listing.html,
// but also seller/listings.html and admin/manage-listings.html, one folder
// deep), and a bare relative path would 404 from those. Root-relative
// resolves correctly regardless of which page renders it, without baking
// in the specific deployment domain.
//
// Usage:
//   node scripts/attach-real-listing-photos.js
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (same as the
// running app). Safe to re-run: each update targets the listing's existing
// single image_url row by id, so re-running just re-sets the same value.

require('dotenv').config({ quiet: true });

// --- Safety guard (same as the other scripts/*.js one-offs) ------------
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

// Listing title -> matching filename in site/Images/, found by loosely
// matching each of the 18 seed-vintage-fashion.js titles against what's
// actually in that folder (ignoring extra words like "shoes", "vintage",
// "top", "bag" in the filename). Two titles have no match in the folder
// at all -- left out of this map entirely rather than guessing.
const TITLE_TO_IMAGE_FILE = {
  'Block Heel Mary Janes': 'Block Heel Mary Janes shoes.jpg',
  'Costume Pearl Drop Earrings': 'Pearl Drop Earrings vintage.jpg',
  'Emerald Velvet Evening Dress': 'Emerald Velvet Evening Dress.jpg',
  'Floral Midi Tea Dress': 'Floral Midi Tea Dress.jpg',
  'Lace Trim Camisole': 'Lace Trim Camisole top.jpg',
  'Leather Chelsea Boots': 'Leather Chelsea Boots.jpg',
  "Men's Wind-Up Wristwatch": "Men's Wind-Up Wristwatch vintage.jpg",
  'Pleated Tartan Mini Skirt': 'Pleated Tartan Mini Skirt.jpg',
  'Polka Dot Shirt Dress': 'Polka Dot Shirt Dress.jpg',
  'Silk Pussy-Bow Blouse': 'Silk Pussy-Bow Blouse.jpg',
  'Silk Scarf, Paisley Print': 'Silk Scarf Paisley Print.jpg',
  'Striped Cotton Boat-Neck Top': 'Striped Cotton Boat-Neck Top.jpg',
  'Structured Leather Satchel': 'Structured Leather Satchel Bag.jpg',
  'Tan Leather Biker Jacket': 'Tan Leather Biker Jacket.jpg',
  'Wide-Leg Corduroy Trousers': 'Wide-Leg Corduroy Trousers.jpg',
  'Wool Herringbone Overcoat': 'Wool Herringbone Overcoat.jpg',
};

// All 18 original seed-vintage-fashion.js titles, so listings with no
// matching file get reported explicitly rather than silently skipped.
const ALL_18_SEEDED_TITLES = [
  'Floral Midi Tea Dress',
  'Emerald Velvet Evening Dress',
  'Polka Dot Shirt Dress',
  'Tan Leather Biker Jacket',
  'Wool Herringbone Overcoat',
  'High-Waisted Straight Leg Jeans',
  'Oversized Denim Jacket',
  'Silk Pussy-Bow Blouse',
  'Striped Cotton Boat-Neck Top',
  'Lace Trim Camisole',
  'Pleated Tartan Mini Skirt',
  'Wide-Leg Corduroy Trousers',
  'Leather Chelsea Boots',
  'Block Heel Mary Janes',
  'Structured Leather Satchel',
  'Silk Scarf, Paisley Print',
  "Men's Wind-Up Wristwatch",
  'Costume Pearl Drop Earrings',
];

function toImageUrl(filename) {
  // Percent-encode spaces only -- apostrophes/commas/hyphens are valid in
  // URL paths as-is, and these filenames only need the spaces escaped.
  return '/Images/' + filename.replace(/ /g, '%20');
}

async function main() {
  const { data: listings, error: listError } = await supabase
    .from('listings')
    .select('id, title, listing_images(id, image_url)')
    .in('title', ALL_18_SEEDED_TITLES);
  if (listError) throw listError;

  const byTitle = new Map(listings.map((l) => [l.title, l]));

  const updated = [];
  const noFileMatch = [];

  for (const title of ALL_18_SEEDED_TITLES) {
    const listing = byTitle.get(title);
    if (!listing) {
      console.warn(`  ! "${title}" not found in the database at all -- skipping`);
      continue;
    }

    const filename = TITLE_TO_IMAGE_FILE[title];
    if (!filename) {
      noFileMatch.push(title);
      continue;
    }

    const imageUrl = toImageUrl(filename);
    const existingImage = listing.listing_images[0]; // each of these 18 was seeded with exactly one row, sort_order 0

    if (!existingImage) {
      // Shouldn't happen for these 18 (all seeded with one image row), but
      // insert rather than silently skip if it ever does.
      const { error } = await supabase
        .from('listing_images')
        .insert({ listing_id: listing.id, image_url: imageUrl, sort_order: 0 });
      if (error) throw error;
    } else {
      const { error } = await supabase.from('listing_images').update({ image_url: imageUrl }).eq('id', existingImage.id);
      if (error) throw error;
    }

    updated.push({ title, filename, imageUrl });
  }

  console.log(`\nUpdated ${updated.length} listing(s):`);
  for (const u of updated) {
    console.log(`  "${u.title}" -> ${u.imageUrl}`);
  }

  console.log(`\nNo matching file found for ${noFileMatch.length} listing(s) (left untouched):`);
  for (const t of noFileMatch) {
    console.log(`  "${t}"`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nScript failed:', err.message || err);
    process.exit(1);
  });
