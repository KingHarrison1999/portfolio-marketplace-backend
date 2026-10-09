// One-off catalog update, additive only:
// 1. Adds an "Other" item-type category under Clothing, Shoes, Accessories
//    and Bags, for both Men and Women (8 categories).
// 2. Creates 5 more fake seller accounts (10 in all) and moves one active
//    listing to each, so every seller shows up in the homepage Top Sellers
//    row (ranked by active listing count).
// 3. Sets each listing's condition to match its description. The seed
//    catalog spread conditions round-robin, which left e.g. a silk scarf
//    marked "for_parts". "for_parts" is no longer used on any listing.
//
// Not part of the app's runtime. Back up first:
//   node scripts/backup-catalog.js <output-dir>
//   node scripts/seed-other-categories-and-sellers.js
//
// Safe to re-run: categories are matched by slug, sellers by email, and
// listings by id, so a second run changes nothing.

require('dotenv').config({ quiet: true });

const crypto = require('crypto');

// Same guard as the other seed scripts: only ever the Portfolio project.
const PORTFOLIO_PROJECT_REF = 'wtjhtsjvbmkanjvgnxvs';
const url = process.env.SUPABASE_URL || '';
if (!url.includes(PORTFOLIO_PROJECT_REF)) {
  throw new Error(`Refusing to run: SUPABASE_URL is not the Portfolio project (${PORTFOLIO_PROJECT_REF}).`);
}

const supabase = require('../lib/db');
const categoriesService = require('../services/categoriesService');

const GROUPS = ['men', 'women'];
const SUBCATEGORIES = ['clothing', 'shoes', 'accessories', 'bags'];

// Fake sellers: made-up names, @example.com addresses (reserved, never
// deliverable). Each takes over one active listing that fits its shop.
const NEW_SELLERS = [
  {
    email: 'nell.harrow.demo@example.com',
    display_name: 'Bootlace Vintage',
    bio: 'Pre-loved boots and shoes, cleaned, conditioned and resoled where they need it.',
    listingId: '3e795aad', // Leather Chelsea Boots
  },
  {
    email: 'tomas.reyes.demo@example.com',
    display_name: 'Rust & Rye Vintage',
    bio: 'Seventies cords, chunky knits and anything in an autumn colour.',
    listingId: '01b9e548', // Wide-Leg Corduroy Trousers
  },
  {
    email: 'ada.kowalski.demo@example.com',
    display_name: 'The Mended Hem',
    bio: 'Everyday secondhand tops and basics, checked over and repaired before listing.',
    listingId: '9ba2c948', // Striped Cotton Boat-Neck Top
  },
  {
    email: 'june.okafor.demo@example.com',
    display_name: 'Twice Loved Threads',
    bio: 'Day dresses and prints from the fifties onwards. Washed, pressed and ready to wear.',
    listingId: '1e119998', // Polka Dot Shirt Dress
  },
  {
    email: 'leo.marsh.demo@example.com',
    display_name: 'Brass Buckle Vintage',
    bio: 'Leather bags, satchels and belts with plenty of life left in them.',
    listingId: 'd0ee24ee', // Structured Leather Satchel
  },
];

// Listing id prefix -> condition that matches its description.
const CONDITIONS = {
  ccc60b6e: 'used', // Navy Suede Retro Trainers: light scuffing
  dc1757d3: 'new', // Kids' Knitted Bobble Hat: new, never worn (removed)
  '911a1c7d': 'used', // High-Waisted Straight Leg Jeans: normal wear
  e2d1980e: 'used', // Oversized Denim Jacket: fraying at the cuffs
  '20d89afa': 'like_new', // Olive Canvas Weekend Backpack: barely used, no marks
  '3e795aad': 'used', // Leather Chelsea Boots: resoled once
  fb118088: 'like_new', // Block Heel Mary Janes: worn indoors a couple of times
  '40d083c8': 'used', // Silk Scarf: small colour fade
  f9cf4623: 'used', // Men's Wind-Up Wristwatch: vintage, strap replaced
  e3acc615: 'like_new', // Costume Pearl Drop Earrings: barely worn
  '01b9e548': 'used', // Wide-Leg Corduroy Trousers: worn, no bald patches
  bc40f0e4: 'used', // Tan Leather Biker Jacket: broken-in, natural creasing
  '0be371a7': 'used', // Wool Herringbone Overcoat: one button reattached
  '320ba81e': 'used', // Silk Pussy-Bow Blouse: gently used
  '9ba2c948': 'used', // Striped Cotton Boat-Neck Top: worn a handful of times
  e0e8552f: 'used', // Lace Trim Camisole: one tiny pull
  d0ee24ee: 'used', // Structured Leather Satchel: worn-in patina
  d6c3cb9e: 'used', // Floral Midi Tea Dress: a little wear on the hem
  '437e3718': 'like_new', // Emerald Velvet Evening Dress: worn once
  '1e119998': 'used', // Polka Dot Shirt Dress: light bobbling
  de652cee: 'used', // Pleated Tartan Mini Skirt: worn, pleats hold
};

async function addOtherCategories() {
  console.log('Adding "Other" categories...');
  const { data: all, error } = await categoriesService.getAllCategories();
  if (error) throw error;
  const bySlug = new Map(all.map((c) => [c.slug, c]));

  for (const group of GROUPS) {
    for (const sub of SUBCATEGORIES) {
      const parent = bySlug.get(`${group}-${sub}`);
      if (!parent) throw new Error(`missing parent category ${group}-${sub}`);
      const slug = `${group}-${sub}-other`;
      if (bySlug.has(slug)) {
        console.log(`  = ${slug} already exists`);
        continue;
      }
      const { data, error: createError } = await categoriesService.createCategory({ name: 'Other', slug, parent_id: parent.id });
      if (createError) throw createError;
      console.log(`  + ${slug} (${data.id})`);
    }
  }
}

async function findAuthUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === email) || null;
}

function findListing(idPrefix, listings) {
  const matches = listings.filter((l) => l.id.startsWith(idPrefix));
  if (matches.length !== 1) throw new Error(`expected one listing with id ${idPrefix}*, found ${matches.length}`);
  return matches[0];
}

async function addSellers(listings) {
  console.log('\nAdding sellers...');
  for (const seller of NEW_SELLERS) {
    let authUser = await findAuthUserByEmail(seller.email);
    if (!authUser) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: seller.email,
        password: crypto.randomBytes(18).toString('hex'),
        email_confirm: true,
        user_metadata: { display_name: seller.display_name },
      });
      if (error) throw error;
      authUser = data.user;
      console.log(`  + ${seller.display_name} (${authUser.id})`);
    } else {
      console.log(`  = ${seller.display_name} already exists (${authUser.id})`);
    }

    // The signup trigger made a 'buyer' profile; upgrade it.
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ role: 'seller', display_name: seller.display_name, bio: seller.bio })
      .eq('id', authUser.id);
    if (profileError) throw profileError;

    const listing = findListing(seller.listingId, listings);
    if (listing.seller_id !== authUser.id) {
      const { error: moveError } = await supabase
        .from('listings')
        .update({ seller_id: authUser.id, updated_at: new Date().toISOString() })
        .eq('id', listing.id);
      if (moveError) throw moveError;
      console.log(`    moved "${listing.title}" to ${seller.display_name}`);
    }
  }
}

async function fixConditions(listings) {
  console.log('\nSetting conditions...');
  const unmapped = listings.filter((l) => !Object.keys(CONDITIONS).some((p) => l.id.startsWith(p)));
  if (unmapped.length) throw new Error(`no condition mapped for: ${unmapped.map((l) => l.title).join(', ')}`);

  for (const [idPrefix, condition] of Object.entries(CONDITIONS)) {
    const listing = findListing(idPrefix, listings);
    if (listing.condition === condition) continue;
    const { error } = await supabase
      .from('listings')
      .update({ condition, updated_at: new Date().toISOString() })
      .eq('id', listing.id);
    if (error) throw error;
    console.log(`  "${listing.title}": ${listing.condition} -> ${condition}`);
  }
}

async function main() {
  console.log(`Updating catalog in ${process.env.SUPABASE_URL}\n`);
  await addOtherCategories();

  const { data: listings, error } = await supabase.from('listings').select('id, title, seller_id, condition');
  if (error) throw error;

  await addSellers(listings);
  await fixConditions(listings);
  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nScript failed:', err.message || err);
    process.exit(1);
  });
