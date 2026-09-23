// One-off reseed: replaces the old collectibles demo catalog with a
// vintage/secondhand-fashion placeholder catalog, as part of rebranding this
// portfolio demo away from "The Collectors Market" niche.
//
// Not part of the app's runtime -- run manually, once, against the
// PORTFOLIO project's Supabase database (see the guard below). Uses the
// same supabase-js client and service layer (lib/db.js, categoriesService,
// listingsService) the app itself uses, rather than raw SQL, so writes go
// through the exact same path as everything else and stay consistent with
// how the schema's constraints/triggers expect data to arrive (e.g. seller
// accounts are real auth.users rows, created via the Auth admin API, since
// profiles.id is a foreign key into auth.users and a DB trigger is what
// creates the profiles row -- there's no way to fake a seller by inserting
// into profiles directly).
//
// Usage:
//   node scripts/seed-vintage-fashion.js
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (same as the
// running app). Safe to re-run: categories are matched by slug and sellers
// by email before creating, so a second run tops up rather than duplicating.

require('dotenv').config({ quiet: true });

const crypto = require('crypto');

// --- Safety guard -----------------------------------------------------
// This account also has access to the REAL client's production Supabase
// project (ref ctgarodvlfmtpcxrmhnf) -- the one the live production site
// actually runs on. This script
// must only ever run against the Portfolio org's "Marketplace" project
// (ref wtjhtsjvbmkanjvgnxvs). Refuse to do anything otherwise, rather than
// trusting whatever .env happens to be loaded.
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
const listingsService = require('../services/listingsService');

// --- Old catalog to retire ---------------------------------------------
const OLD_CATEGORY_NAMES = [
  'Cars',
  'Military Vehicles',
  'Aviation',
  'Rail',
  'Scenery',
  'Scalextric',
  'Trading Cards',
  'Diorama',
  'Other Collectibles',
];

// --- New catalog ---------------------------------------------------------
const NEW_CATEGORIES = [
  { name: 'Dresses', slug: 'dresses' },
  { name: 'Outerwear & Jackets', slug: 'outerwear-jackets' },
  { name: 'Denim', slug: 'denim' },
  { name: 'Tops & Blouses', slug: 'tops-blouses' },
  { name: 'Skirts & Trousers', slug: 'skirts-trousers' },
  { name: 'Shoes', slug: 'shoes' },
  { name: 'Bags & Accessories', slug: 'bags-accessories' },
  { name: 'Jewellery & Watches', slug: 'jewellery-watches' },
];

// Fake sellers -- names not tied to any real person, @example.com addresses
// (the reserved, non-deliverable test domain) so nothing can ever actually
// be emailed.
const FAKE_SELLERS = [
  { key: 'isla', email: 'isla.bennett.demo@example.com', display_name: "Isla's Vintage Rail", bio: 'Curating pre-loved dresses and eveningwear since forever. Based in Bristol.' },
  { key: 'marcus', email: 'marcus.whitfield.demo@example.com', display_name: 'Whitfield & Co. Vintage', bio: "Menswear and outerwear specialist -- if it's got a story, we've probably got a rail of it." },
  { key: 'priya', email: 'priya.anand.demo@example.com', display_name: "Priya's Preloved", bio: 'Secondhand denim and everyday staples, sorted and steamed before they ever reach you.' },
  { key: 'sam', email: 'sam.oconnor.demo@example.com', display_name: 'Retro Thread Co', bio: 'Small vintage shop, big rail of accessories, bags and jewellery.' },
  { key: 'freya', email: 'freya.nakamura.demo@example.com', display_name: "Freya's Closet Finds", bio: 'Shoes, skirts and the odd showstopper. One-off pieces, always.' },
];

// Must match the DB's listings_condition_check constraint (see
// supabase/migrations/20260825120000_profiles_public_view_and_check_constraints.sql).
const CONDITIONS = ['new', 'like_new', 'used', 'for_parts'];

// 18 listings across the 8 categories (2-3 each), assigned round-robin
// across the 5 sellers. Conditions are spread round-robin across CONDITIONS
// for visual variety, not matched to each item's description. imageSeed
// feeds picsum.photos' deterministic seeded endpoint, so re-running the
// script points at the same placeholder image per listing rather than a new
// random one each time.
const LISTINGS = [
  { category: 'dresses', seller: 'isla', title: 'Floral Midi Tea Dress', description: 'Cotton-blend tea dress in a faded floral print. Side zip, knee-length, fully lined. A little wear on the hem, nothing that shows when worn.', price: 28, condition: 'new', imageSeed: 'vf-dress-1' },
  { category: 'dresses', seller: 'isla', title: 'Emerald Velvet Evening Dress', description: 'Deep green velvet, fitted bodice, floor-length. One previous owner, worn once to a wedding. Small hook-and-eye repair at the back, invisible when worn.', price: 65, condition: 'like_new', imageSeed: 'vf-dress-2' },
  { category: 'dresses', seller: 'freya', title: 'Polka Dot Shirt Dress', description: 'Classic polka dot shirt dress with a tie waist. Machine washable, true to size. Light bobbling under the arms.', price: 19, condition: 'used', imageSeed: 'vf-dress-3' },

  { category: 'outerwear-jackets', seller: 'marcus', title: 'Tan Leather Biker Jacket', description: 'Genuine leather biker jacket, tan colourway, asymmetric zip. Soft, broken-in leather with natural creasing -- no rips or repairs.', price: 85, condition: 'for_parts', imageSeed: 'vf-jacket-1' },
  { category: 'outerwear-jackets', seller: 'marcus', title: 'Wool Herringbone Overcoat', description: 'Full-length herringbone wool overcoat, single-breasted. Warm and heavy, ideal for winter. One button reattached, matches the originals.', price: 52, condition: 'new', imageSeed: 'vf-jacket-2' },

  { category: 'denim', seller: 'priya', title: 'High-Waisted Straight Leg Jeans', description: 'Classic five-pocket straight leg jeans, high rise, mid-wash denim. No fading beyond normal wear.', price: 22, condition: 'like_new', imageSeed: 'vf-denim-1' },
  { category: 'denim', seller: 'priya', title: 'Oversized Denim Jacket', description: 'Boxy oversized denim jacket, light stonewash. Two chest pockets, button front. Some fraying at the cuffs, part of the look.', price: 24, condition: 'used', imageSeed: 'vf-denim-2' },

  { category: 'tops-blouses', seller: 'priya', title: 'Silk Pussy-Bow Blouse', description: 'Cream silk blouse with a tie neck. Beautiful drape, gently used. Dry clean only.', price: 18, condition: 'for_parts', imageSeed: 'vf-top-1' },
  { category: 'tops-blouses', seller: 'freya', title: 'Striped Cotton Boat-Neck Top', description: 'Breton-style striped top, boat neck, three-quarter sleeves. A wardrobe staple, worn a handful of times.', price: 12, condition: 'new', imageSeed: 'vf-top-2' },
  { category: 'tops-blouses', seller: 'isla', title: 'Lace Trim Camisole', description: 'Delicate lace-trimmed camisole in ivory. Adjustable straps. One tiny pull in the fabric near the hem, not noticeable when worn.', price: 9, condition: 'like_new', imageSeed: 'vf-top-3' },

  { category: 'skirts-trousers', seller: 'freya', title: 'Pleated Tartan Mini Skirt', description: 'Classic pleated tartan mini, side zip, fully lined. Pleats hold their shape well.', price: 16, condition: 'used', imageSeed: 'vf-skirt-1' },
  { category: 'skirts-trousers', seller: 'marcus', title: 'Wide-Leg Corduroy Trousers', description: 'High-waisted wide-leg corduroy trousers in rust. Deep pockets, belt loops. Corduroy is soft with no bald patches.', price: 26, condition: 'for_parts', imageSeed: 'vf-trouser-1' },

  { category: 'shoes', seller: 'freya', title: 'Leather Chelsea Boots', description: 'Black leather Chelsea boots with elastic side panels. Resoled once, plenty of life left in them.', price: 38, condition: 'new', imageSeed: 'vf-shoes-1' },
  { category: 'shoes', seller: 'freya', title: 'Block Heel Mary Janes', description: 'Burgundy patent block-heel Mary Janes with a buckle strap. Worn indoors only, a couple of times.', price: 29, condition: 'like_new', imageSeed: 'vf-shoes-2' },

  { category: 'bags-accessories', seller: 'sam', title: 'Structured Leather Satchel', description: 'Tan leather satchel with brass buckles and an adjustable strap. Interior lining intact, exterior has a nice worn-in patina.', price: 45, condition: 'used', imageSeed: 'vf-bag-1' },
  { category: 'bags-accessories', seller: 'sam', title: 'Silk Scarf, Paisley Print', description: 'Square silk scarf in a classic paisley print. Hand-rolled edges. Small colour fade on one corner from folding.', price: 11, condition: 'for_parts', imageSeed: 'vf-bag-2' },

  { category: 'jewellery-watches', seller: 'sam', title: "Men's Wind-Up Wristwatch", description: 'Mechanical wind-up wristwatch, stainless case, leather strap replaced with a new one. Keeps good time.', price: 34, condition: 'new', imageSeed: 'vf-watch-1' },
  { category: 'jewellery-watches', seller: 'sam', title: 'Costume Pearl Drop Earrings', description: 'Faux pearl drop earrings, gold-tone fittings. Clip-on, no piercing needed. Excellent condition, barely worn.', price: 8, condition: 'like_new', imageSeed: 'vf-jewellery-1' },
];

function placeholderImageUrl(seed) {
  return `https://picsum.photos/seed/${seed}/800/600`;
}

async function findCategoryBySlug(slug) {
  const { data, error } = await supabase.from('categories').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertCategory(cat) {
  const existing = await findCategoryBySlug(cat.slug);
  if (existing) {
    console.log(`  = category "${cat.name}" already exists, reusing (${existing.id})`);
    return existing;
  }
  const { data, error } = await categoriesService.createCategory({ name: cat.name, slug: cat.slug });
  if (error) throw error;
  console.log(`  + created category "${cat.name}" (${data.id})`);
  return data;
}

async function findAuthUserByEmail(email) {
  // supabase-js v2's admin.listUsers() has no server-side email filter, so
  // this pages through everything and matches client-side. Fine at seed-
  // script scale (a handful of fake accounts against a demo project).
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === email) || null;
}

async function upsertSeller(seller) {
  let authUser = await findAuthUserByEmail(seller.email);

  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: seller.email,
      password: crypto.randomBytes(18).toString('hex'),
      email_confirm: true, // skip the confirmation email entirely -- no real inbox behind these
      user_metadata: { display_name: seller.display_name },
    });
    if (error) throw error;
    authUser = data.user;
    console.log(`  + created auth user for "${seller.display_name}" (${authUser.id})`);
  } else {
    console.log(`  = auth user for "${seller.display_name}" already exists, reusing (${authUser.id})`);
  }

  // The on_auth_user_created trigger already inserted a 'buyer' profiles row
  // -- upgrade it to seller and fill in the bio, same fields a real user
  // hitting POST /api/profile/become-seller then PATCH /api/profile would end
  // up with.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .update({ role: 'seller', bio: seller.bio, display_name: seller.display_name })
    .eq('id', authUser.id)
    .select()
    .single();
  if (profileError) throw profileError;

  return profile;
}

async function retireOldCatalog() {
  console.log('\nRetiring old collectibles catalog...');

  const { data: oldCategories, error: fetchError } = await supabase
    .from('categories')
    .select('id, name')
    .in('name', OLD_CATEGORY_NAMES);
  if (fetchError) throw fetchError;

  if (oldCategories.length === 0) {
    console.log('  no old categories found (already cleaned up, or a fresh database)');
    return;
  }

  const oldCategoryIds = oldCategories.map((c) => c.id);
  console.log(`  found ${oldCategories.length} old categories: ${oldCategories.map((c) => c.name).join(', ')}`);

  // Deactivate (not hard-delete) any listings still tied to them -- same
  // soft-delete listingsService.softDeleteListing() already uses elsewhere,
  // so history (order_items snapshot the title/price at purchase time) stays
  // intact, but nothing stale shows up in GET /api/listings (which only
  // returns status = 'active').
  const { data: staleListings, error: staleFetchError } = await supabase
    .from('listings')
    .select('id, title, status')
    .in('category_id', oldCategoryIds)
    .neq('status', 'removed');
  if (staleFetchError) throw staleFetchError;

  if (staleListings.length > 0) {
    const { error: updateError } = await supabase
      .from('listings')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .in('id', staleListings.map((l) => l.id));
    if (updateError) throw updateError;
    console.log(`  deactivated ${staleListings.length} old listing(s) still tied to those categories:`);
    for (const l of staleListings) {
      console.log(`    - "${l.title}" (was ${l.status}) -> removed`);
    }
  } else {
    console.log('  no active/draft/sold listings were tied to the old categories');
  }

  // Now the categories themselves. categories.slug is unique -- if any old
  // slug were ever reused by a new one this would conflict, but the new
  // vintage-fashion slugs share nothing with the old ones, so plain
  // deletes are safe. listings.category_id is ON DELETE SET NULL, so this
  // can't cascade-delete anything even if a listing was missed above.
  for (const cat of oldCategories) {
    const { error } = await categoriesService.deleteCategory(cat.id);
    if (error) throw error;
    console.log(`  - deleted category "${cat.name}"`);
  }
}

async function main() {
  console.log(`Seeding vintage-fashion demo catalog against ${process.env.SUPABASE_URL}\n`);

  await retireOldCatalog();

  console.log('\nCreating vintage-fashion categories...');
  const categoryBySlug = {};
  for (const cat of NEW_CATEGORIES) {
    categoryBySlug[cat.slug] = await upsertCategory(cat);
  }

  console.log('\nCreating fake seller accounts...');
  const sellerByKey = {};
  for (const seller of FAKE_SELLERS) {
    sellerByKey[seller.key] = await upsertSeller(seller);
  }

  console.log('\nCreating listings...');
  let created = 0;
  for (const item of LISTINGS) {
    const category = categoryBySlug[item.category];
    const seller = sellerByKey[item.seller];

    // Idempotency: skip if this exact seller already has a listing with this
    // exact title, rather than piling up duplicates on a re-run.
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

    // Publish it -- createListing() defaults to 'draft' (matches the real
    // seller flow), but a seed catalog should actually be visible.
    const { error: activateError } = await supabase
      .from('listings')
      .update({ status: 'active' })
      .eq('id', listing.id);
    if (activateError) throw activateError;

    const { error: imageError } = await supabase
      .from('listing_images')
      .insert({ listing_id: listing.id, image_url: placeholderImageUrl(item.imageSeed), sort_order: 0 });
    if (imageError) throw imageError;

    console.log(`  + "${item.title}" (£${item.price}, ${item.condition}) by ${seller.display_name} in ${category.name}`);
    created += 1;
  }

  console.log(`\nDone. ${created} new listing(s) created.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSeed script failed:', err.message || err);
    process.exit(1);
  });
