// Read-only backup: dumps categories, listings (with images) and seller
// profiles to timestamped JSON files, so a catalog change can be undone by
// hand. Makes no writes to the database.
//
// Usage:
//   node scripts/backup-catalog.js <output-dir>
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');

// Same guard as the seed scripts: never run against the real client project.
const PORTFOLIO_PROJECT_REF = 'wtjhtsjvbmkanjvgnxvs';
const url = process.env.SUPABASE_URL || '';
if (!url.includes(PORTFOLIO_PROJECT_REF)) {
  throw new Error(`Refusing to run: SUPABASE_URL is not the Portfolio project (${PORTFOLIO_PROJECT_REF}).`);
}

const supabase = require('../lib/db');

async function dump(table, select = '*') {
  const { data, error } = await supabase.from(table).select(select);
  if (error) throw error;
  return data;
}

async function main() {
  const outDir = process.argv[2];
  if (!outDir) throw new Error('Usage: node scripts/backup-catalog.js <output-dir>');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const sets = {
    categories: await dump('categories'),
    listings: await dump('listings', '*, listing_images(*)'),
    profiles: await dump('profiles', 'id, role, display_name, bio, avatar_url, created_at'),
  };
  for (const [name, rows] of Object.entries(sets)) {
    const file = path.join(outDir, `${name}-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    console.log(`${rows.length} ${name} -> ${file}`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Backup failed:', err.message || err);
  process.exit(1);
});
