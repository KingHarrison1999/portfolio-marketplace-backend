// One-off cleanup of the live demo catalog after a listings audit (photos vs
// descriptions, non-fashion/test items). Brings an already-seeded database
// in line with the updated seed scripts:
//
//   1. Deletes the leftover "Seller Flow Test Cardigan" draft (created by a
//      seller-flow API test, not by any seed script).
//   2. Deletes the 4 Junior listings (any that are on an order are soft-
//      deleted to status 'removed' instead, since order_items store no
//      title), then the whole Junior category tree
//      (categories.parent_id is ON DELETE SET NULL, so the subtree is
//      deleted explicitly, deepest first, rather than orphaning children
//      into new top-level categories). Refuses if any listing still uses it.
//   3. Sets 4 listings whose picsum placeholder photos are random landscapes
//      to 'draft' (hidden from the public API, not deleted -- real photos
//      to follow).
//   4. Rewrites descriptions that contradicted their photos, and retitles
//      the scarf to match its print.
//   5. Moves "Wide-Leg Corduroy Trousers" from Men > Clothing > Jeans to
//      Women > Clothing > Trousers.
//
// Listings are matched by seller email + title, never by hard-coded id.
// Every step is idempotent: re-running after success changes nothing.
//
// Usage:
//   node scripts/clean-demo-catalog.js            dry run: prints the exact changes, writes nothing
//   node scripts/clean-demo-catalog.js --apply    makes the changes
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
require('dotenv').config({ quiet: true });

// --- Safety guard (same as the seed scripts) ---------------------------
const PORTFOLIO_PROJECT_REF = 'wtjhtsjvbmkanjvgnxvs';
const REAL_CLIENT_PROJECT_REF = 'ctgarodvlfmtpcxrmhnf';
const url = process.env.SUPABASE_URL || '';
if (url.includes(REAL_CLIENT_PROJECT_REF)) {
  throw new Error(`Refusing to run: SUPABASE_URL points at the REAL CLIENT project (${REAL_CLIENT_PROJECT_REF}).`);
}
if (!url.includes(PORTFOLIO_PROJECT_REF)) {
  throw new Error(`Refusing to run: SUPABASE_URL is not the Portfolio project (${PORTFOLIO_PROJECT_REF}). Got "${url}".`);
}

const supabase = require('../lib/db');

const APPLY = process.argv.includes('--apply');

const SELLERS = {
  isla: 'isla.bennett.demo@example.com',
  marcus: 'marcus.whitfield.demo@example.com',
  priya: 'priya.anand.demo@example.com',
  sam: 'sam.oconnor.demo@example.com',
  freya: 'freya.nakamura.demo@example.com',
};

const DELETE_LISTINGS = [
  { seller: 'isla', title: 'Seller Flow Test Cardigan' },
  { seller: 'isla', title: "Kids' Dinosaur Print T-Shirt" },
  { seller: 'freya', title: "Kids' Velcro Trainers" },
  { seller: 'sam', title: "Kids' Dinosaur Backpack" },
  { seller: 'priya', title: "Kids' Knitted Bobble Hat" },
];

const DRAFT_LISTINGS = [
  { seller: 'priya', title: 'High-Waisted Straight Leg Jeans' },
  { seller: 'priya', title: 'Oversized Denim Jacket' },
  { seller: 'marcus', title: 'Navy Suede Retro Trainers' },
  { seller: 'marcus', title: 'Olive Canvas Weekend Backpack' },
];

// Must match the LISTINGS entries in scripts/seed-vintage-fashion.js.
const REWRITES = [
  {
    seller: 'freya',
    title: 'Leather Chelsea Boots',
    description: 'Brown leather Chelsea boots with elastic side panels. Resoled once, plenty of life left in them.',
  },
  {
    seller: 'freya',
    title: 'Block Heel Mary Janes',
    description: 'Black Mary Janes with a low heel and a buckle strap. Worn indoors only, a couple of times.',
  },
  {
    seller: 'sam',
    title: 'Silk Scarf, Paisley Print',
    newTitle: 'Silk Scarf, Abstract Print',
    description: 'Square silk scarf in a bright abstract print. Hand-rolled edges. Small colour fade on one corner from folding.',
  },
  {
    seller: 'sam',
    title: "Men's Wind-Up Wristwatch",
    description: 'Mechanical wind-up wristwatch with a rose-gold case, leather strap replaced with a new one. Keeps good time.',
  },
  {
    seller: 'sam',
    title: 'Costume Pearl Drop Earrings',
    description: 'Faux pearl drop earrings with silver-tone fittings. Clip-on, no piercing needed. Excellent condition, barely worn.',
  },
];

const MOVE = { seller: 'marcus', title: 'Wide-Leg Corduroy Trousers', toSlug: 'women-clothing-trousers' };
const JUNIOR_ROOT_SLUG = 'junior';

async function sellerIds() {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const out = {};
  for (const [key, email] of Object.entries(SELLERS)) {
    const user = data.users.find((u) => u.email === email);
    if (!user) throw new Error(`seller account ${email} not found`);
    out[key] = user.id;
  }
  return out;
}

async function findListing(sellerId, title) {
  const { data, error } = await supabase
    .from('listings')
    .select('id, title, description, status, category_id')
    .eq('seller_id', sellerId)
    .eq('title', title)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function short(s, n = 70) {
  return s && s.length > n ? `${s.slice(0, n)}...` : s;
}

async function main() {
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (nothing is written)'} against ${url}\n`);
  const seller = await sellerIds();

  // 1 + 2a. Delete listings
  console.log('Delete listings (their listing_images and cart_items cascade):');
  for (const item of DELETE_LISTINGS) {
    const listing = await findListing(seller[item.seller], item.title);
    if (!listing) { console.log(`  = "${item.title}" already gone`); continue; }
    const { count: orderRefs } = await supabase.from('order_items').select('id', { count: 'exact', head: true }).eq('listing_id', listing.id);
    const { count: cartRefs } = await supabase.from('cart_items').select('id', { count: 'exact', head: true }).eq('listing_id', listing.id);
    // order_items store no title, so hard-deleting a listing that's on an
    // order would leave that order line nameless. Those get the app's own
    // soft delete (status 'removed', as listingsService.softDeleteListing
    // uses) instead: hidden everywhere, order history intact.
    if (orderRefs > 0) {
      if (listing.status === 'removed') { console.log(`  = "${item.title}" already soft-deleted (on ${orderRefs} order)`); continue; }
      console.log(`  ~ SOFT-DELETE listing ${listing.id} "${listing.title}": status ${listing.status} -> removed (on ${orderRefs} order, so kept for order history)`);
      if (APPLY) {
        const { error } = await supabase.from('listings').update({ status: 'removed', updated_at: new Date().toISOString() }).eq('id', listing.id);
        if (error) throw error;
      }
      continue;
    }
    console.log(`  - DELETE listing ${listing.id} "${listing.title}" [${listing.status}] (order_items: 0, cart_items: ${cartRefs || 0})`);
    if (APPLY) {
      const { error } = await supabase.from('listings').delete().eq('id', listing.id);
      if (error) throw error;
    }
  }

  // 2b. Junior category tree
  console.log('\nDelete the Junior category tree:');
  const { data: cats, error: catsError } = await supabase.from('categories').select('id, name, slug, parent_id');
  if (catsError) throw catsError;
  const root = cats.find((c) => c.slug === JUNIOR_ROOT_SLUG);
  if (!root) {
    console.log('  = already gone');
  } else {
    const levels = [[root]];
    while (true) {
      const parentIds = new Set(levels[levels.length - 1].map((c) => c.id));
      const next = cats.filter((c) => parentIds.has(c.parent_id));
      if (next.length === 0) break;
      levels.push(next);
    }
    const tree = levels.flat();
    // In apply mode the Junior listings are already deleted above; in a dry
    // run, discount the ones that step would delete.
    const deleting = new Set();
    for (const item of DELETE_LISTINGS) {
      const l = await findListing(seller[item.seller], item.title);
      if (l) deleting.add(l.id);
    }
    // Soft-deleted listings don't block: listings.category_id is ON DELETE
    // SET NULL, so they just lose a category nothing will ever show.
    const { data: users, error: usersError } = await supabase.from('listings').select('id, title, status').in('category_id', tree.map((c) => c.id));
    if (usersError) throw usersError;
    const blocking = users.filter((l) => !deleting.has(l.id) && l.status !== 'removed');
    if (blocking.length) {
      throw new Error(`Junior tree still used by: ${blocking.map((l) => l.title).join(', ')} -- not deleting it`);
    }
    console.log(`  - DELETE ${tree.length} categories (root "${root.name}", ${levels.map((l) => l.length).join(' + ')} by depth); no live listings use them after step 1 (soft-deleted ones get category_id = null)`);
    if (APPLY) {
      for (const level of levels.slice().reverse()) {
        const { error } = await supabase.from('categories').delete().in('id', level.map((c) => c.id));
        if (error) throw error;
      }
    }
  }

  // 3. Draft
  console.log('\nSet to draft (hidden, not deleted):');
  for (const item of DRAFT_LISTINGS) {
    const listing = await findListing(seller[item.seller], item.title);
    if (!listing) throw new Error(`"${item.title}" not found`);
    if (listing.status === 'draft') { console.log(`  = "${item.title}" already draft`); continue; }
    console.log(`  ~ ${listing.id} "${item.title}": status ${listing.status} -> draft`);
    if (APPLY) {
      const { error } = await supabase.from('listings').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', listing.id);
      if (error) throw error;
    }
  }

  // 4. Rewrites
  console.log('\nRewrite to match the photo:');
  for (const item of REWRITES) {
    let listing = await findListing(seller[item.seller], item.title);
    if (!listing && item.newTitle) listing = await findListing(seller[item.seller], item.newTitle);
    if (!listing) throw new Error(`"${item.title}" not found`);
    const patch = {};
    if (item.newTitle && listing.title !== item.newTitle) patch.title = item.newTitle;
    if (listing.description !== item.description) patch.description = item.description;
    if (!Object.keys(patch).length) { console.log(`  = "${listing.title}" already up to date`); continue; }
    console.log(`  ~ ${listing.id} "${listing.title}"`);
    if (patch.title) console.log(`      title:       "${listing.title}" -> "${patch.title}"`);
    if (patch.description) {
      console.log(`      description: "${listing.description}"`);
      console.log(`               ->  "${patch.description}"`);
    }
    if (APPLY) {
      const { error } = await supabase.from('listings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', listing.id);
      if (error) throw error;
    }
  }

  // 5. Move
  console.log('\nMove category:');
  const target = cats.find((c) => c.slug === MOVE.toSlug);
  if (!target) throw new Error(`category ${MOVE.toSlug} not found`);
  const path = (id) => { const out = []; let c = cats.find((x) => x.id === id); while (c) { out.unshift(c.name); c = cats.find((x) => x.id === c.parent_id); } return out.join(' > '); };
  const moving = await findListing(seller[MOVE.seller], MOVE.title);
  if (!moving) throw new Error(`"${MOVE.title}" not found`);
  if (moving.category_id === target.id) {
    console.log(`  = "${MOVE.title}" already in ${path(target.id)}`);
  } else {
    console.log(`  ~ ${moving.id} "${MOVE.title}": ${path(moving.category_id)} -> ${path(target.id)}`);
    if (APPLY) {
      const { error } = await supabase.from('listings').update({ category_id: target.id, updated_at: new Date().toISOString() }).eq('id', moving.id);
      if (error) throw error;
    }
  }

  const { count } = await supabase.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'active');
  console.log(`\nActive listings now: ${count}${APPLY ? '' : ' (unchanged -- dry run)'}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nclean-demo-catalog failed:', err.message || err);
    process.exit(1);
  });
