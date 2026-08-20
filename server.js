const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://school_recommender_user:C4VqE0XntfHl36hbc6XcKBuPjSdvWHUT@dpg-d8g5qtog4nts73bboum0-a.oregon-postgres.render.com/school_recommender',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

pool.connect((err) => {
  if (err) { console.error('Database connection failed:', err); return; }
  console.log('Connected to PostgreSQL database!');
});

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function q(text, params) {
  let i = 0;
  const converted = text.replace(/\?/g, () => `$${++i}`);
  return pool.query(converted, params);
}

app.get('/', (req, res) => {
  res.json({ message: 'School Recommender API is running!' });
});

app.get('/schools', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM schools');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/recommend', async (req, res) => {
  const { curriculum, max_distance, budget_max, gender_pref, grade_level, home_lat, home_lng, weight_academics, weight_distance, weight_fees, activities, sen_needs } = req.body;
  try {
    const result = await pool.query('SELECT * FROM schools');
    let schools = result.rows;

    let filtered = schools.filter(school => {
      if (curriculum && school.curriculum !== curriculum) return false;
      if (budget_max && school.fees_min && parseInt(school.fees_min) > parseInt(budget_max)) return false;      if (gender_pref && school.gender_policy !== gender_pref) return false;
      return true;
    });

    let scored = filtered.map(school => {
      let distanceScore = 0;
      if (home_lat && home_lng && school.latitude && school.longitude) {
        const km = getDistance(home_lat, home_lng, parseFloat(school.latitude), parseFloat(school.longitude));
        distanceScore = Math.max(0, 100 - (km / (max_distance || 20)) * 100);
      }

      let feesScore = 0;
      if (school.fees_min && budget_max) {
        feesScore = Math.max(0, 100 - (school.fees_min / budget_max) * 100);
      }

      let academicsScore = school.rating ? parseFloat(school.rating) * 20 : 50;

      let activitiesScore = 0;
      if (activities && activities.length > 0 && school.activities) {
        const schoolActivities = school.activities.toLowerCase();
        const matches = activities.filter(a => schoolActivities.includes(a.toLowerCase()));
        activitiesScore = (matches.length / activities.length) * 100;
      }

      let senScore = 0;
      if (sen_needs && sen_needs.length > 0) {
        if (school.has_sen && school.sen_support) {
          const schoolSen = JSON.parse(school.sen_support);
          const matches = sen_needs.filter(n => schoolSen.includes(n));
          senScore = (matches.length / sen_needs.length) * 100;
        }
      }

      const wAcademics = parseFloat(weight_academics) || 0.30;
      const wDistance = parseFloat(weight_distance) || 0.25;
      const wFees = parseFloat(weight_fees) || 0.20;
      const wActivities = 0.15;
      const wSen = sen_needs && sen_needs.length > 0 ? 0.10 : 0;
      const wScale = 1 / (wAcademics + wDistance + wFees + wActivities + wSen);

      let score = (
        (academicsScore * wAcademics) +
        (distanceScore * wDistance) +
        (feesScore * wFees) +
        (activitiesScore * wActivities) +
        (senScore * wSen)
      ) * wScale;

      return {
        school_id: school.school_id,
        name: school.name_en,
        name_ar: school.name_ar,
        curriculum: school.curriculum,
        district: school.district,
        fees_min: school.fees_min,
        fees_max: school.fees_max,
        rating: school.rating,
        language: school.language,
        grades_offered: school.grades_offered,
        university_pathway: school.university_pathway,
        website: school.website,
        bus_service: school.bus_service,
        counseling: school.counseling,
        special_needs: school.special_needs,
        has_sen: school.has_sen,
        sen_support: school.sen_support,
        latitude: school.latitude,
        longitude: school.longitude,
        match_score: Math.min(99, Math.round(score)),
      };
    });

    scored.sort((a, b) => b.match_score - a.match_score);
    res.json(scored.slice(0, 10));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/signup', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await q('INSERT INTO users (name, email, password_hash, phone, role) VALUES (?, ?, ?, ?, ?) RETURNING user_id', [name, email, hash, phone, 'parent']);
    const userId = result.rows[0].user_id;
    const sessionId = uuidv4();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await q('INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)', [sessionId, userId, expires]);
    res.json({ session_id: sessionId, user: { user_id: userId, name, email, phone } });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  try {
    const result = await q('SELECT * FROM users WHERE email = ?', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    const sessionId = uuidv4();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await q('INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)', [sessionId, user.user_id, expires]);
    res.json({ session_id: sessionId, user: { user_id: user.user_id, name: user.name, email: user.email, phone: user.phone } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/logout', async (req, res) => {
  const { session_id } = req.body;
  await q('DELETE FROM sessions WHERE session_id = ?', [session_id]);
  res.json({ success: true });
});

app.get('/me', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  if (!session_id) return res.status(401).json({ error: 'No session' });
  try {
    const result = await q('SELECT u.user_id, u.name, u.email, u.phone FROM sessions s JOIN users u ON s.user_id = u.user_id WHERE s.session_id = ? AND s.expires_at > NOW()', [session_id]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired session' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getUserId(session_id) {
  const result = await q('SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()', [session_id]);
  if (result.rows.length === 0) return null;
  return result.rows[0].user_id;
}

app.post('/favorites', async (req, res) => {
  const { school_id } = req.body;
  const session_id = req.headers['x-session-id'];
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    await q('INSERT INTO favorites (user_id, school_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [user_id, school_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/favorites/:school_id', async (req, res) => {
  const { school_id } = req.params;
  const session_id = req.headers['x-session-id'];
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    await q('DELETE FROM favorites WHERE user_id = ? AND school_id = ?', [user_id, school_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/favorites', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q('SELECT s.*, f.created_at as favorited_at FROM favorites f JOIN schools s ON f.school_id = s.school_id WHERE f.user_id = ? ORDER BY f.created_at DESC', [user_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/preferences', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { curriculum, grade, budget, weight_academics, weight_distance, weight_fees } = req.body;
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    await q(`INSERT INTO preferences (user_id, curriculum_type, grade_level, budget_max, weight_academics, weight_distance, weight_fees) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET curriculum_type=EXCLUDED.curriculum_type, grade_level=EXCLUDED.grade_level, budget_max=EXCLUDED.budget_max, weight_academics=EXCLUDED.weight_academics, weight_distance=EXCLUDED.weight_distance, weight_fees=EXCLUDED.weight_fees, updated_at=CURRENT_TIMESTAMP`, [user_id, curriculum, grade, budget, weight_academics, weight_distance, weight_fees]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/preferences', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q('SELECT * FROM preferences WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', [user_id]);
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/messages', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { school_id, content } = req.body;
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q('INSERT INTO messages (user_id, school_id, content, sender) VALUES (?, ?, ?, ?) RETURNING message_id', [user_id, school_id, content, 'parent']);
    res.json({ success: true, message_id: result.rows[0].message_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/conversations', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q(`SELECT s.school_id, s.name_en, s.district, s.curriculum,
      (SELECT content FROM messages WHERE user_id = ? AND school_id = s.school_id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE user_id = ? AND school_id = s.school_id ORDER BY created_at DESC LIMIT 1) as last_time,
      (SELECT COUNT(*) FROM messages WHERE user_id = ? AND school_id = s.school_id AND is_read = FALSE AND sender = 'school') as unread
     FROM schools s WHERE s.school_id IN (SELECT DISTINCT school_id FROM messages WHERE user_id = ?) ORDER BY last_time DESC`, [user_id, user_id, user_id, user_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/messages/:school_id', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { school_id } = req.params;
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q('SELECT * FROM messages WHERE user_id = ? AND school_id = ? ORDER BY created_at ASC', [user_id, school_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/meetings', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { school_id, meeting_type, meeting_date, meeting_time, notes } = req.body;
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q('INSERT INTO meetings (user_id, school_id, meeting_type, meeting_date, meeting_time, notes) VALUES (?, ?, ?, ?, ?, ?) RETURNING meeting_id', [user_id, school_id, meeting_type, meeting_date, meeting_time, notes]);
    res.json({ success: true, meeting_id: result.rows[0].meeting_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/meetings', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q(`SELECT m.*, s.name_en as school_name, s.district FROM meetings m JOIN schools s ON m.school_id = s.school_id WHERE m.user_id = ? ORDER BY m.meeting_date ASC, m.meeting_time ASC`, [user_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/meetings/:meeting_id/cancel', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { meeting_id } = req.params;
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    await q('UPDATE meetings SET status = ? WHERE meeting_id = ? AND user_id = ?', ['cancelled', meeting_id, user_id]);
    await q('DELETE FROM referral_codes WHERE meeting_id = ? AND user_id = ?', [meeting_id, user_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/posts', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  try {
    const result = await pool.query(`SELECT p.*, s.name_en as school_name, s.name_ar as school_name_ar, s.curriculum, s.district FROM posts p JOIN schools s ON p.school_id = s.school_id ORDER BY p.created_at DESC`);
    const posts = result.rows;
    if (!session_id) return res.json(posts.map(p => ({ ...p, liked: false })));
    const user_id = await getUserId(session_id);
    if (!user_id) return res.json(posts.map(p => ({ ...p, liked: false })));
    const likes = await q('SELECT post_id FROM post_likes WHERE user_id = ?', [user_id]);
    const likedIds = new Set(likes.rows.map(l => l.post_id));
    res.json(posts.map(p => ({ ...p, liked: likedIds.has(p.post_id) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/posts/:post_id/like', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { post_id } = req.params;
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const existing = await q('SELECT like_id FROM post_likes WHERE post_id = ? AND user_id = ?', [post_id, user_id]);
    if (existing.rows.length > 0) {
      await q('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [post_id, user_id]);
      await q('UPDATE posts SET likes = likes - 1 WHERE post_id = ?', [post_id]);
      res.json({ liked: false });
    } else {
      await q('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [post_id, user_id]);
      await q('UPDATE posts SET likes = likes + 1 WHERE post_id = ?', [post_id]);
      res.json({ liked: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/activities', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { activities } = req.body;
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    await q('UPDATE users SET activities = ? WHERE user_id = ?', [JSON.stringify(activities), user_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/activities', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q('SELECT activities FROM users WHERE user_id = ?', [user_id]);
    const activities = result.rows[0]?.activities ? JSON.parse(result.rows[0].activities) : [];
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/school/signup', async (req, res) => {
  const { school_id, email, password, phone } = req.body;
  if (!school_id || !email || !password) return res.status(400).json({ error: 'School ID, email and password are required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    await q('UPDATE schools SET email = ?, password_hash = ?, phone = ? WHERE school_id = ?', [email, hash, phone, school_id]);
    const sessionId = uuidv4();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await q('INSERT INTO school_sessions (session_id, school_id, expires_at) VALUES (?, ?, ?)', [sessionId, school_id, expires]);
    const school = await q('SELECT * FROM schools WHERE school_id = ?', [school_id]);
    res.json({ session_id: sessionId, school: school.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/school/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  try {
    const result = await q('SELECT * FROM schools WHERE email = ?', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });
    const school = result.rows[0];
    const match = await bcrypt.compare(password, school.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    const sessionId = uuidv4();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await q('INSERT INTO school_sessions (session_id, school_id, expires_at) VALUES (?, ?, ?)', [sessionId, school.school_id, expires]);
    res.json({ session_id: sessionId, school });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getSchoolId(session_id) {
  const result = await q('SELECT school_id FROM school_sessions WHERE session_id = ? AND expires_at > NOW()', [session_id]);
  if (result.rows.length === 0) return null;
  return result.rows[0].school_id;
}

app.get('/school/dashboard', async (req, res) => {
  const session_id = req.headers['x-school-session'];
  try {
    const school_id = await getSchoolId(session_id);
    if (!school_id) return res.status(401).json({ error: 'Unauthorized' });
    const [school, messages, meetings, enrollments] = await Promise.all([
      q('SELECT * FROM schools WHERE school_id = ?', [school_id]),
      q('SELECT COUNT(*) as count FROM messages WHERE school_id = ?', [school_id]),
      q('SELECT COUNT(*) as count FROM meetings WHERE school_id = ?', [school_id]),
      q('SELECT COUNT(*) as count FROM enrollments WHERE school_id = ?', [school_id]),
    ]);
    res.json({ school: school.rows[0], stats: { messages: messages.rows[0].count, meetings: meetings.rows[0].count, enrollments: enrollments.rows[0].count } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/school/leads', async (req, res) => {
  const session_id = req.headers['x-school-session'];
  try {
    const school_id = await getSchoolId(session_id);
    if (!school_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q(`SELECT DISTINCT u.user_id, u.name, u.email, u.phone,
      (SELECT created_at FROM messages WHERE user_id = u.user_id AND school_id = ? ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT meeting_date FROM meetings WHERE user_id = u.user_id AND school_id = ? ORDER BY created_at DESC LIMIT 1) as meeting_date,
      (SELECT status FROM meetings WHERE user_id = u.user_id AND school_id = ? ORDER BY created_at DESC LIMIT 1) as meeting_status
      FROM users u WHERE u.user_id IN (
        SELECT DISTINCT user_id FROM messages WHERE school_id = ?
        UNION SELECT DISTINCT user_id FROM meetings WHERE school_id = ?
      ) ORDER BY last_message DESC NULLS LAST`, [school_id, school_id, school_id, school_id, school_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/school/confirm-enrollment', async (req, res) => {
  const session_id = req.headers['x-school-session'];
  const { code, tuition_amount } = req.body;
  try {
    const school_id = await getSchoolId(session_id);
    if (!school_id) return res.status(401).json({ error: 'Unauthorized' });
    const codeResult = await q('SELECT * FROM referral_codes WHERE code = ? AND school_id = ? AND status = ?', [code, school_id, 'pending']);
    if (codeResult.rows.length === 0) return res.status(404).json({ error: 'Invalid or already used code' });
    const referral = codeResult.rows[0];
    const commission_rate = 0.04;
    const commission_amount = Math.round(tuition_amount * commission_rate);
    await q('UPDATE referral_codes SET status = ? WHERE code_id = ?', ['used', referral.code_id]);
    await q('INSERT INTO enrollments (code_id, school_id, user_id, tuition_amount, commission_rate, commission_amount) VALUES (?, ?, ?, ?, ?, ?)', [referral.code_id, school_id, referral.user_id, tuition_amount, commission_rate, commission_amount]);
    const parent = await q('SELECT name, email, phone FROM users WHERE user_id = ?', [referral.user_id]);
    res.json({ success: true, commission_amount, parent: parent.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/school/post', async (req, res) => {
  const session_id = req.headers['x-school-session'];
  const { caption, media_url, media_type } = req.body;
  try {
    const school_id = await getSchoolId(session_id);
    if (!school_id) return res.status(401).json({ error: 'Unauthorized' });
    await q('INSERT INTO posts (school_id, caption, media_url, media_type) VALUES (?, ?, ?, ?)', [school_id, caption, media_url, media_type || 'image']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/school/profile', async (req, res) => {
  const session_id = req.headers['x-school-session'];
  const { bio, phone, fees_min, fees_max } = req.body;
  try {
    const school_id = await getSchoolId(session_id);
    if (!school_id) return res.status(401).json({ error: 'Unauthorized' });
    await q('UPDATE schools SET bio = ?, phone = ?, fees_min = ?, fees_max = ? WHERE school_id = ?', [bio, phone, fees_min, fees_max, school_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/referral/generate', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { meeting_id, school_id } = req.body;
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const code = 'MDR-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    await q('INSERT INTO referral_codes (code, meeting_id, user_id, school_id) VALUES (?, ?, ?, ?)', [code, meeting_id, user_id, school_id]);
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/my-referral-codes', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q(`
      SELECT r.code, r.status, r.created_at,
             s.name_en as school_name, s.district,
             m.meeting_date, m.meeting_type
      FROM referral_codes r
      JOIN schools s ON r.school_id = s.school_id
      LEFT JOIN meetings m ON r.meeting_id = m.meeting_id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `, [user_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/referral/:meeting_id', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { meeting_id } = req.params;
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q('SELECT code FROM referral_codes WHERE meeting_id = ? AND user_id = ?', [meeting_id, user_id]);
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save parent SEN needs
app.post('/sen/parent', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { sen_needs } = req.body;
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    await q('UPDATE users SET sen_needs = ? WHERE user_id = ?', [JSON.stringify(sen_needs), user_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get parent SEN needs
app.get('/sen/parent', async (req, res) => {
  const session_id = req.headers['x-session-id'];
  try {
    const user_id = await getUserId(session_id);
    if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
    const result = await q('SELECT sen_needs FROM users WHERE user_id = ?', [user_id]);
    const sen_needs = result.rows[0]?.sen_needs ? JSON.parse(result.rows[0].sen_needs) : [];
    res.json(sen_needs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save school SEN support
app.post('/sen/school', async (req, res) => {
  const session_id = req.headers['x-school-session'];
  const { sen_support, has_sen } = req.body;
  try {
    const school_id = await getSchoolId(session_id);
    if (!school_id) return res.status(401).json({ error: 'Unauthorized' });
    await q('UPDATE schools SET sen_support = ?, has_sen = ? WHERE school_id = ?', [JSON.stringify(sen_support), has_sen, school_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Waitlist signup
app.post('/waitlist', async (req, res) => {
  const { email, name, type } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    await q('INSERT INTO waitlist (email, name, type) VALUES (?, ?, ?)', [email, name, type || 'parent']);
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'You are already on the waitlist!' });
    res.status(500).json({ error: err.message });
  }
});

// Get waitlist count
app.get('/waitlist/count', async (req, res) => {
  try {
    const result = await q('SELECT COUNT(*) as count FROM waitlist', []);
    res.json({ count: result.rows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit app review
app.post('/reviews', async (req, res) => {
  const { name, rating, comment, type } = req.body;
  if (!name || !rating || !comment) return res.status(400).json({ error: 'All fields are required' });
  try {
    await q('INSERT INTO app_reviews (name, rating, comment, type) VALUES (?, ?, ?, ?)', [name, rating, comment, type || 'parent']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get approved reviews
app.get('/reviews', async (req, res) => {
  try {
    const result = await q('SELECT * FROM app_reviews WHERE approved = TRUE ORDER BY created_at DESC', []);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve review (admin only)
app.put('/reviews/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    await q('UPDATE app_reviews SET approved = TRUE WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all reviews (admin)
app.get('/reviews/all', async (req, res) => {
  try {
    const result = await q('SELECT * FROM app_reviews ORDER BY created_at DESC', []);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete review
app.delete('/reviews/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await q('DELETE FROM app_reviews WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running on port', process.env.PORT || 3000);
});