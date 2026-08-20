const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://school_recommender_user:C4VqE0XntfHl36hbc6XcKBuPjSdvWHUT@dpg-d8g5qtog4nts73bboum0-a.oregon-postgres.render.com/school_recommender',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS activities TEXT DEFAULT '[]'`);
  console.log('✓ added activities column');
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sen_needs TEXT DEFAULT '[]'`);
  console.log('✓ added sen_needs column');
  await pool.end();
  console.log('Done!');
}

run().catch(err => { console.error(err); process.exit(1); });
