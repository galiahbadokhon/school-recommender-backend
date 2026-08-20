const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://school_recommender_user:C4VqE0XntfHl36hbc6XcKBuPjSdvWHUT@dpg-d8g5qtog4nts73bboum0-a.oregon-postgres.render.com/school_recommender',
  ssl: { rejectUnauthorized: false },
});

const NAMES = [
  { en: 'Greenfield Academy',         ar: 'أكاديمية غرينفيلد' },
  { en: 'Riverside International',    ar: 'مدرسة ريفرسايد الدولية' },
  { en: 'Oakwood British School',     ar: 'مدرسة أوكوود البريطانية' },
  { en: 'Elmwood Academy',            ar: 'أكاديمية إلموود' },
  { en: 'Sunrise International',      ar: 'مدرسة صنرايز الدولية' },
  { en: 'Maplewood School',           ar: 'مدرسة مابلوود' },
  { en: 'Horizon Academy',            ar: 'أكاديمية هورايزون' },
  { en: 'Cedarwood International',    ar: 'مدرسة سيدارووود الدولية' },
  { en: 'Pinehurst Academy',          ar: 'أكاديمية باينهيرست' },
  { en: 'Willowbrook School',         ar: 'مدرسة ويلوبروك' },
  { en: 'Ashford International',      ar: 'مدرسة آشفورد الدولية' },
  { en: 'Brightwater Academy',        ar: 'أكاديمية برايتووتر' },
  { en: 'Lakeside British School',    ar: 'المدرسة البريطانية على البحيرة' },
  { en: 'Hillcrest International',    ar: 'مدرسة هيلكريست الدولية' },
  { en: 'Meadowfield Academy',        ar: 'أكاديمية ميدووفيلد' },
  { en: 'Clearview School',           ar: 'مدرسة كليرفيو' },
  { en: 'Harborview International',   ar: 'مدرسة هاربورفيو الدولية' },
  { en: 'Stonegate Academy',          ar: 'أكاديمية ستونغيت' },
  { en: 'Foxfield School',            ar: 'مدرسة فوكسفيلد' },
  { en: 'Northgate International',    ar: 'مدرسة نورثغيت الدولية' },
  { en: 'Westbrook Academy',          ar: 'أكاديمية ويستبروك' },
  { en: 'Summitview School',          ar: 'مدرسة سوميتفيو' },
  { en: 'Parkside International',     ar: 'مدرسة باركسايد الدولية' },
  { en: 'Goldenfield Academy',        ar: 'أكاديمية غولدنفيلد' },
  { en: 'Silverwood School',          ar: 'مدرسة سيلفروود' },
  { en: 'Fernwood International',     ar: 'مدرسة فيرنووود الدولية' },
  { en: 'Brightfield Academy',        ar: 'أكاديمية برايتفيلد' },
  { en: 'Thornwood School',           ar: 'مدرسة ثورنووود' },
  { en: 'Ivyfield International',     ar: 'مدرسة إيفيفيلد الدولية' },
  { en: 'Brookside Academy',          ar: 'أكاديمية بروكسايد' },
];

async function run() {
  const result = await pool.query('SELECT school_id FROM schools ORDER BY school_id');
  const ids = result.rows.map(r => r.school_id);
  console.log(`Found ${ids.length} schools`);

  for (let i = 0; i < ids.length; i++) {
    const name = NAMES[i % NAMES.length];
    const suffix = i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : '';
    await pool.query(
      'UPDATE schools SET name_en = $1, name_ar = $2 WHERE school_id = $3',
      [name.en + suffix, name.ar + suffix, ids[i]]
    );
    console.log(`✓ ${ids[i]} → ${name.en + suffix}`);
  }

  console.log('\nDone!');
  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
