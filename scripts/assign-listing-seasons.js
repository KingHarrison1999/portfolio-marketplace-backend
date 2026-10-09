// One-off: tags every existing demo listing with the seasons it suits
// (listings.seasons, added by migration 20261009100000_listings_seasons),
// judged from its title and description. Matches on title, so it's safe to
// re-run; a listing whose title isn't below is reported and left alone.
// Back up first: node scripts/backup-catalog.js <output-dir>
//
// Usage:
//   node scripts/assign-listing-seasons.js            # dry run, prints the plan
//   node scripts/assign-listing-seasons.js --apply    # writes it
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.

require('dotenv').config({ quiet: true });

// Same guard as the seed scripts: never run against the real client project.
const PORTFOLIO_PROJECT_REF = 'wtjhtsjvbmkanjvgnxvs';
const url = process.env.SUPABASE_URL || '';
if (!url.includes(PORTFOLIO_PROJECT_REF)) {
  throw new Error(`Refusing to run: SUPABASE_URL is not the Portfolio project (${PORTFOLIO_PROJECT_REF}).`);
}

const supabase = require('../lib/db');

const ALL_YEAR = ['spring', 'summer', 'autumn', 'winter'];

// Year-round pieces (jewellery, watches, bags) get all four seasons.
const SEASONS_BY_TITLE = {
  'Navy Suede Retro Trainers': ['spring', 'summer', 'autumn'],
  "Kids' Knitted Bobble Hat": ['autumn', 'winter'],
  'Oversized Denim Jacket': ['spring', 'autumn'],
  'Olive Canvas Weekend Backpack': ALL_YEAR,
  'Leather Chelsea Boots': ['autumn', 'winter'],
  'Block Heel Mary Janes': ['spring', 'autumn'],
  'Striped Cotton Boat-Neck Top': ['spring', 'summer'],
  'Lace Trim Camisole': ['summer'],
  'Costume Pearl Drop Earrings': ALL_YEAR,
  'Polka Dot Shirt Dress': ['spring', 'summer'],
  'Structured Leather Satchel': ALL_YEAR,
  'High-Waisted Straight Leg Jeans': ['spring', 'autumn', 'winter'],
  'Silk Scarf, Abstract Print': ['spring', 'autumn'],
  "Men's Wind-Up Wristwatch": ALL_YEAR,
  'Wide-Leg Corduroy Trousers': ['autumn', 'winter'],
  'Tan Leather Biker Jacket': ['spring', 'autumn'],
  'Wool Herringbone Overcoat': ['autumn', 'winter'],
  'Silk Pussy-Bow Blouse': ['spring', 'autumn'],
  'Floral Midi Tea Dress': ['spring', 'summer'],
  'Emerald Velvet Evening Dress': ['autumn', 'winter'],
  'Pleated Tartan Mini Skirt': ['autumn', 'winter'],
};

async function main() {
  const apply = process.argv.includes('--apply');

  const { data: listings, error } = await supabase.from('listings').select('id, title, status, seasons').order('title');
  if (error) throw error;

  let unmatched = 0;
  for (const listing of listings) {
    const seasons = SEASONS_BY_TITLE[listing.title];
    if (!seasons) {
      unmatched += 1;
      console.log(`SKIP  ${listing.title} (${listing.status}) -- no seasons defined`);
      continue;
    }
    console.log(`${apply ? 'SET ' : 'PLAN'}  ${listing.title} (${listing.status}): ${seasons.join(', ')}`);
    if (apply) {
      const { error: updateError } = await supabase.from('listings').update({ seasons }).eq('id', listing.id);
      if (updateError) throw updateError;
    }
  }
  console.log(`\n${listings.length} listings, ${listings.length - unmatched} ${apply ? 'updated' : 'to update'}, ${unmatched} skipped.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Season assignment failed:', err.message || err);
  process.exit(1);
});
