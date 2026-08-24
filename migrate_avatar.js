const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://school_recommender_user:C4VqE0XntfHl36hbc6XcKBuPjSdvWHUT@dpg-d8g5qtog4nts73bboum0-a.oregon-postgres.render.com/school_recommender',
  ssl: { rejectUnauthorized: false },
});
async function run() {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`);
  console.log('✓ avatar column added');
  await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });
