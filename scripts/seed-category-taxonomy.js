// One-off reseed: replaces the flat 8-category vintage-fashion list with a
// 3-level taxonomy (Main category -> Subcategory -> Item type), and
// reassigns the 18 seeded listings from scripts/seed-vintage-fashion.js to
// whichever leaf category fits each one.
//
// Not part of the app's runtime -- run manually, once, against the
// PORTFOLIO project's Supabase database (see the guard below). Uses the
// same supabase-js client and service layer (lib/db.js, categoriesService)
// the app itself uses, rather than raw SQL.
//
// The categories table's parent_id self-reference already supports
// arbitrary depth (it's a plain adjacency list, not limited to one level),
// so no schema/migration change was needed for this -- this script only
// adds data.
//
// Usage:
//   node scripts/seed-category-taxonomy.js
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

// --- Old flat catalog to retire (from seed-vintage-fashion.js) ---------
const OLD_CATEGORY_NAMES = [
  'Dresses',
  'Outerwear & Jackets',
  'Denim',
  'Tops & Blouses',
  'Skirts & Trousers',
  'Shoes',
  'Bags & Accessories',
  'Jewellery & Watches',
];

// --- New 3-level taxonomy ------------------------------------------------
// No 'Junior' branch: it was removed (with its placeholder listings) by
// scripts/clean-demo-catalog.js, so a reseed doesn't bring back an empty tree.
const MAIN_CATEGORIES = ['Men', 'Women', 'New Arrivals', 'Secondhand'];
const SUBCATEGORIES = ['Clothing', 'Shoes', 'Bags', 'Accessories'];
const ITEM_TYPES = {
  Clothing: ['T-Shirts', 'Jackets and Coats', 'Hoodies', 'Shirts', 'Jeans', 'Sport Wear', 'Underwear'],
  Shoes: ['Sneakers', 'Boots', 'Loafers', 'Dress Shoes', 'Sandals and Slippers'],
  Bags: ['Backpacks', 'Belt Bags', 'Shoulder Bags', 'Tote Bags'],
  Accessories: ['Hats', 'Gloves and Scarfs', 'Belts', 'Sunglasses', 'Jewelry'],
};

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Which leaf (main > sub > item type) each of the 18 seeded listings
// belongs in. The requested item-type list has no "Dresses"/"Skirts"/
// generic "Trousers" bucket, so dresses, blouses, tops and the mini skirt
// are placed under Clothing > Shirts (the closest existing bucket), and
// the corduroy trousers (women's -- see the photo) under Clothing > Jeans --
// noted here rather than silently forced.
// scripts/add-womens-clothing-item-types.js later adds Women's Dresses /
// Skirts / Trousers and moves these into them.
const LISTING_ASSIGNMENTS = [
  { title: 'Floral Midi Tea Dress', main: 'Women', sub: 'Clothing', item: 'Shirts' },
  { title: 'Emerald Velvet Evening Dress', main: 'Women', sub: 'Clothing', item: 'Shirts' },
  { title: 'Polka Dot Shirt Dress', main: 'Women', sub: 'Clothing', item: 'Shirts' },
  { title: 'Tan Leather Biker Jacket', main: 'Men', sub: 'Clothing', item: 'Jackets and Coats' },
  { title: 'Wool Herringbone Overcoat', main: 'Men', sub: 'Clothing', item: 'Jackets and Coats' },
  { title: 'High-Waisted Straight Leg Jeans', main: 'Women', sub: 'Clothing', item: 'Jeans' },
  { title: 'Oversized Denim Jacket', main: 'Women', sub: 'Clothing', item: 'Jackets and Coats' },
  { title: 'Silk Pussy-Bow Blouse', main: 'Women', sub: 'Clothing', item: 'Shirts' },
  { title: 'Striped Cotton Boat-Neck Top', main: 'Women', sub: 'Clothing', item: 'Shirts' },
  { title: 'Lace Trim Camisole', main: 'Women', sub: 'Clothing', item: 'Underwear' },
  { title: 'Pleated Tartan Mini Skirt', main: 'Women', sub: 'Clothing', item: 'Shirts' },
  { title: 'Wide-Leg Corduroy Trousers', main: 'Women', sub: 'Clothing', item: 'Jeans' },
  { title: 'Leather Chelsea Boots', main: 'Women', sub: 'Shoes', item: 'Boots' },
  { title: 'Block Heel Mary Janes', main: 'Women', sub: 'Shoes', item: 'Dress Shoes' },
  { title: 'Structured Leather Satchel', main: 'Women', sub: 'Bags', item: 'Shoulder Bags' },
  { title: 'Silk Scarf, Abstract Print', main: 'Women', sub: 'Accessories', item: 'Gloves and Scarfs' },
  { title: "Men's Wind-Up Wristwatch", main: 'Men', sub: 'Accessories', item: 'Jewelry' },
  { title: 'Costume Pearl Drop Earrings', main: 'Women', sub: 'Accessories', item: 'Jewelry' },
];

async function findCategoryBySlug(slug) {
  const { data, error } = await supabase.from('categories').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertCategory(name, slug, parentId) {
  const existing = await findCategoryBySlug(slug);
  if (existing) {
    if (existing.parent_id !== parentId) {
      // Self-heal: an earlier run left this row's parent_id stale/null
      // (e.g. its old parent got deleted). Slugs are globally unique per
      // branch, so re-pointing it at the parent this run expects is safe.
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

async function buildTaxonomy() {
  console.log('\nBuilding 3-level category taxonomy...');

  // leafCategories keyed by "Main > Sub > Item" for the reassignment step.
  const leafCategories = {};
  const tree = [];

  for (const mainName of MAIN_CATEGORIES) {
    const mainSlug = slugify(mainName);
    const mainCategory = await upsertCategory(mainName, mainSlug, null);
    const mainNode = { ...mainCategory, subcategories: [] };

    for (const subName of SUBCATEGORIES) {
      const subSlug = `${mainSlug}-${slugify(subName)}`;
      const subCategory = await upsertCategory(subName, subSlug, mainCategory.id);
      const subNode = { ...subCategory, itemTypes: [] };

      for (const itemName of ITEM_TYPES[subName]) {
        const itemSlug = `${mainSlug}-${slugify(subName)}-${slugify(itemName)}`;
        const itemCategory = await upsertCategory(itemName, itemSlug, subCategory.id);
        subNode.itemTypes.push(itemCategory);
        leafCategories[`${mainName}>${subName}>${itemName}`] = itemCategory;
      }

      mainNode.subcategories.push(subNode);
    }

    tree.push(mainNode);
  }

  return { tree, leafCategories };
}

async function reassignListings(leafCategories) {
  console.log('\nReassigning the 18 seeded listings to the new taxonomy...');

  for (const assignment of LISTING_ASSIGNMENTS) {
    const key = `${assignment.main}>${assignment.sub}>${assignment.item}`;
    const leaf = leafCategories[key];
    if (!leaf) throw new Error(`No category built for ${key}`);

    const { data: listing, error: findError } = await supabase
      .from('listings')
      .select('id, title')
      .eq('title', assignment.title)
      .maybeSingle();
    if (findError) throw findError;
    if (!listing) {
      console.log(`  ! listing "${assignment.title}" not found, skipping`);
      continue;
    }

    const { error: updateError } = await supabase
      .from('listings')
      .update({ category_id: leaf.id, updated_at: new Date().toISOString() })
      .eq('id', listing.id);
    if (updateError) throw updateError;

    console.log(`  "${assignment.title}" -> ${assignment.main} / ${assignment.sub} / ${assignment.item}`);
  }
}

// Captured BEFORE buildTaxonomy() runs, and matched on parent_id is null
// as well as name -- the new taxonomy creates its own categories sharing
// some of the same names (e.g. every main category gets a "Shoes"
// subcategory), so matching on name alone after the new tree exists would
// catch those too. This bit the first run of this script: it matched and
// deleted the 5 newly-created "Shoes" subcategories along with the actual
// old flat "Shoes" category, orphaning their item-type children.
async function captureOldCategoryIds() {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name')
    .in('name', OLD_CATEGORY_NAMES)
    .is('parent_id', null);
  if (error) throw error;
  return data;
}

async function retireOldCategories(oldCategories) {
  console.log('\nRetiring the old flat category list...');

  if (oldCategories.length === 0) {
    console.log('  none found (already cleaned up, or a fresh database)');
    return;
  }

  for (const cat of oldCategories) {
    const { count, error: countError } = await categoriesService.countActiveListings(cat.id);
    if (countError) throw countError;
    if (count > 0) {
      console.log(`  ! "${cat.name}" still has ${count} active listing(s) referencing it -- skipping delete`);
      continue;
    }
    const { error } = await categoriesService.deleteCategory(cat.id);
    if (error) throw error;
    console.log(`  - deleted "${cat.name}"`);
  }
}

function printTree(tree) {
  console.log('\nFinal taxonomy:');
  for (const main of tree) {
    console.log(`- ${main.name}`);
    for (const sub of main.subcategories) {
      console.log(`  - ${sub.name}`);
      for (const item of sub.itemTypes) {
        console.log(`    - ${item.name}`);
      }
    }
  }
}

async function main() {
  console.log(`Restructuring categories against ${process.env.SUPABASE_URL}`);

  const oldCategories = await captureOldCategoryIds();
  const { tree, leafCategories } = await buildTaxonomy();
  await reassignListings(leafCategories);
  await retireOldCategories(oldCategories);
  printTree(tree);

  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSeed script failed:', err.message || err);
    process.exit(1);
  });
