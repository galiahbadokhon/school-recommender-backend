const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

cconst dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'school_recommender',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.DB_HOST ? { rejectUnauthorized: false } : false,
  connectTimeout: 60000,
  authPlugins: undefined,
  authSwitchHandler: undefined,
};

const db = mysql.createPool(dbConfig);

db.getConnection((err, connection) => {
  if (err) {
    console.error('Database connection failed:', err);
    return;
  }
  console.log('Connected to MySQL database!');
  connection.release();
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

app.get('/', (req, res) => {
  res.json({ message: 'School Recommender API is running!' });
});

app.get('/schools', (req, res) => {
  db.query('SELECT * FROM schools', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post('/recommend', (req, res) => {
  const {
    curriculum, max_distance, budget_max, gender_pref,
    grade_level, home_lat, home_lng,
    weight_academics, weight_distance, weight_fees,
    activities
  } = req.body;

  db.query('SELECT * FROM schools', (err, schools) => {
    if (err) return res.status(500).json({ error: err.message });

    let filtered = schools.filter(school => {
      if (curriculum && school.curriculum !== curriculum) return false;
      if (budget_max && school.fees_min > budget_max) return false;
      if (gender_pref && school.gender_policy !== gender_pref) return false;
      return true;
    });

    let scored = filtered.map(school => {
      let distanceScore = 0;
      if (home_lat && home_lng && school.latitude && school.longitude) {
        const km = getDistance(home_lat, home_lng, school.latitude, school.longitude);
        distanceScore = Math.max(0, 100 - (km / (max_distance || 20)) * 100);
      }

      let feesScore = 0;
      if (school.fees_min && budget_max) {
        feesScore = Math.max(0, 100 - (school.fees_min / budget_max) * 100);
      }

      let academicsScore = school.rating ? school.rating * 20 : 50;

      let activitiesScore = 0;
      if (activities && activities.length > 0 && school.activities) {
        const schoolActivities = school.activities.toLowerCase();
        const matches = activities.filter(a => schoolActivities.includes(a.toLowerCase()));
        activitiesScore = (matches.length / activities.length) * 100;
      }

      let score =
        (academicsScore  * (weight_academics || 0.30)) +
        (distanceScore   * (weight_distance  || 0.25)) +
        (feesScore       * (weight_fees      || 0.20)) +
        (activitiesScore * 0.15);

      return {
        school_id:          school.school_id,
        name:               school.name_en,
        curriculum:         school.curriculum,
        district:           school.district,
        fees_min:           school.fees_min,
        fees_max:           school.fees_max,
        rating:             school.rating,
        language:           school.language,
        grades_offered:     school.grades_offered,
        university_pathway: school.university_pathway,
        website:            school.website,
        bus_service:        school.bus_service,
        counseling:         school.counseling,
        special_needs:      school.special_needs,
        latitude:           school.latitude,
        longitude:          school.longitude,
        match_score:        Math.round(score),
      };
    });

    scored.sort((a, b) => b.match_score - a.match_score);
    res.json(scored.slice(0, 10));
  });
});

app.post('/signup', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  const hash = await bcrypt.hash(password, 10);
  db.query(
    'INSERT INTO users (name, email, password_hash, phone, role) VALUES (?, ?, ?, ?, ?)',
    [name, email, hash, phone, 'parent'],
    (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already exists' });
        return res.status(500).json({ error: err.message });
      }
      const sessionId = uuidv4();
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      db.query(
        'INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)',
        [sessionId, result.insertId, expires],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ session_id: sessionId, user: { user_id: result.insertId, name, email, phone } });
        }
      );
    }
  );
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const user = results[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    const sessionId = uuidv4();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    db.query(
      'INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)',
      [sessionId, user.user_id, expires],
      (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ session_id: sessionId, user: { user_id: user.user_id, name: user.name, email: user.email, phone: user.phone } });
      }
    );
  });
});

app.post('/logout', (req, res) => {
  const { session_id } = req.body;
  db.query('DELETE FROM sessions WHERE session_id = ?', [session_id], () => {
    res.json({ success: true });
  });
});

app.get('/me', (req, res) => {
  const session_id = req.headers['x-session-id'];
  if (!session_id) return res.status(401).json({ error: 'No session' });

  db.query(
    'SELECT u.user_id, u.name, u.email, u.phone FROM sessions s JOIN users u ON s.user_id = u.user_id WHERE s.session_id = ? AND s.expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0) return res.status(401).json({ error: 'Invalid or expired session' });
      res.json(results[0]);
    }
  );
});

app.post('/favorites', (req, res) => {
  const { school_id } = req.body;
  const session_id = req.headers['x-session-id'];

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        'INSERT IGNORE INTO favorites (user_id, school_id) VALUES (?, ?)',
        [user_id, school_id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true });
        }
      );
    }
  );
});

app.delete('/favorites/:school_id', (req, res) => {
  const { school_id } = req.params;
  const session_id = req.headers['x-session-id'];

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        'DELETE FROM favorites WHERE user_id = ? AND school_id = ?',
        [user_id, school_id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true });
        }
      );
    }
  );
});

app.get('/favorites', (req, res) => {
  const session_id = req.headers['x-session-id'];

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        `SELECT s.*, f.created_at as favorited_at 
         FROM favorites f 
         JOIN schools s ON f.school_id = s.school_id 
         WHERE f.user_id = ?
         ORDER BY f.created_at DESC`,
        [user_id],
        (err2, schools) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(schools);
        }
      );
    }
  );
});

app.post('/preferences', (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { curriculum, grade, budget, weight_academics, weight_distance, weight_fees } = req.body;

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        `INSERT INTO preferences (user_id, curriculum_type, grade_level, budget_max, weight_academics, weight_distance, weight_fees)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         curriculum_type=VALUES(curriculum_type), grade_level=VALUES(grade_level),
         budget_max=VALUES(budget_max), weight_academics=VALUES(weight_academics),
         weight_distance=VALUES(weight_distance), weight_fees=VALUES(weight_fees),
         updated_at=CURRENT_TIMESTAMP`,
        [user_id, curriculum, grade, budget, weight_academics, weight_distance, weight_fees],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true });
        }
      );
    }
  );
});

app.get('/preferences', (req, res) => {
  const session_id = req.headers['x-session-id'];

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        'SELECT * FROM preferences WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
        [user_id],
        (err2, prefs) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(prefs[0] || null);
        }
      );
    }
  );
});

app.post('/messages', (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { school_id, content } = req.body;

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        'INSERT INTO messages (user_id, school_id, content, sender) VALUES (?, ?, ?, ?)',
        [user_id, school_id, content, 'parent'],
        (err2, result) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true, message_id: result.insertId });
        }
      );
    }
  );
});

app.get('/conversations', (req, res) => {
  const session_id = req.headers['x-session-id'];

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        `SELECT s.school_id, s.name_en, s.district, s.curriculum,
          (SELECT content FROM messages WHERE user_id = ? AND school_id = s.school_id ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM messages WHERE user_id = ? AND school_id = s.school_id ORDER BY created_at DESC LIMIT 1) as last_time,
          (SELECT COUNT(*) FROM messages WHERE user_id = ? AND school_id = s.school_id AND is_read = FALSE AND sender = 'school') as unread
         FROM schools s
         WHERE s.school_id IN (SELECT DISTINCT school_id FROM messages WHERE user_id = ?)
         ORDER BY last_time DESC`,
        [user_id, user_id, user_id, user_id],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(rows);
        }
      );
    }
  );
});

app.get('/messages/:school_id', (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { school_id } = req.params;

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        'SELECT * FROM messages WHERE user_id = ? AND school_id = ? ORDER BY created_at ASC',
        [user_id, school_id],
        (err2, messages) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(messages);
        }
      );
    }
  );
});

app.post('/meetings', (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { school_id, meeting_type, meeting_date, meeting_time, notes } = req.body;

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        'INSERT INTO meetings (user_id, school_id, meeting_type, meeting_date, meeting_time, notes) VALUES (?, ?, ?, ?, ?, ?)',
        [user_id, school_id, meeting_type, meeting_date, meeting_time, notes],
        (err2, result) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true, meeting_id: result.insertId });
        }
      );
    }
  );
});

app.get('/meetings', (req, res) => {
  const session_id = req.headers['x-session-id'];

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        `SELECT m.*, s.name_en as school_name, s.district 
         FROM meetings m 
         JOIN schools s ON m.school_id = s.school_id 
         WHERE m.user_id = ? 
         ORDER BY m.meeting_date ASC, m.meeting_time ASC`,
        [user_id],
        (err2, meetings) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(meetings);
        }
      );
    }
  );
});

app.put('/meetings/:meeting_id/cancel', (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { meeting_id } = req.params;

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        'UPDATE meetings SET status = ? WHERE meeting_id = ? AND user_id = ?',
        ['cancelled', meeting_id, user_id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true });
        }
      );
    }
  );
});

app.get('/posts', (req, res) => {
  const session_id = req.headers['x-session-id'];

  db.query(
    `SELECT p.*, s.name_en as school_name, s.curriculum, s.district
     FROM posts p
     JOIN schools s ON p.school_id = s.school_id
     ORDER BY p.created_at DESC`,
    (err, posts) => {
      if (err) return res.status(500).json({ error: err.message });

      if (!session_id) return res.json(posts.map(p => ({ ...p, liked: false })));

      db.query(
        'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
        [session_id],
        (err2, results) => {
          if (err2 || results.length === 0) return res.json(posts.map(p => ({ ...p, liked: false })));
          const user_id = results[0].user_id;
          db.query(
            'SELECT post_id FROM post_likes WHERE user_id = ?',
            [user_id],
            (err3, likes) => {
              if (err3) return res.json(posts.map(p => ({ ...p, liked: false })));
              const likedIds = new Set(likes.map(l => l.post_id));
              res.json(posts.map(p => ({ ...p, liked: likedIds.has(p.post_id) })));
            }
          );
        }
      );
    }
  );
});

app.post('/posts/:post_id/like', (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { post_id } = req.params;

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;

      db.query(
        'SELECT like_id FROM post_likes WHERE post_id = ? AND user_id = ?',
        [post_id, user_id],
        (err2, existing) => {
          if (existing && existing.length > 0) {
            db.query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [post_id, user_id]);
            db.query('UPDATE posts SET likes = likes - 1 WHERE post_id = ?', [post_id]);
            res.json({ liked: false });
          } else {
            db.query('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [post_id, user_id]);
            db.query('UPDATE posts SET likes = likes + 1 WHERE post_id = ?', [post_id]);
            res.json({ liked: true });
          }
        }
      );
    }
  );
});

app.post('/activities', (req, res) => {
  const session_id = req.headers['x-session-id'];
  const { activities } = req.body;

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        'UPDATE users SET activities = ? WHERE user_id = ?',
        [JSON.stringify(activities), user_id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true });
        }
      );
    }
  );
});

app.get('/activities', (req, res) => {
  const session_id = req.headers['x-session-id'];

  db.query(
    'SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > NOW()',
    [session_id],
    (err, results) => {
      if (err || results.length === 0) return res.status(401).json({ error: 'Unauthorized' });
      const user_id = results[0].user_id;
      db.query(
        'SELECT activities FROM users WHERE user_id = ?',
        [user_id],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          const activities = rows[0]?.activities ? JSON.parse(rows[0].activities) : [];
          res.json(activities);
        }
      );
    }
  );
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running on port', process.env.PORT || 3000);
});