import mysql.connector
import psycopg2

mysql_conn = mysql.connector.connect(
    host='127.0.0.1',
    port=3306,
    user='root',
    database='school_recommender'
)
mysql_cursor = mysql_conn.cursor(dictionary=True)

pg_conn = psycopg2.connect("postgresql://school_recommender_user:C4VqE0XntfHl36hbc6XcKBuPjSdvWHUT@dpg-d8g5qtog4nts73bboum0-a.oregon-postgres.render.com/school_recommender")
pg_cursor = pg_conn.cursor()

def to_bool(val):
    if val is None: return None
    return bool(val)

# Migrate schools
print("Migrating schools...")
mysql_cursor.execute("SELECT * FROM schools")
schools = mysql_cursor.fetchall()
for s in schools:
    pg_cursor.execute("""
        INSERT INTO schools (school_id, name_en, name_ar, curriculum, school_type, gender_policy,
        district, latitude, longitude, fees_min, fees_max, grades_offered, language, rating,
        bus_service, counseling, special_needs, university_pathway, website, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (school_id) DO NOTHING
    """, (s['school_id'], s['name_en'], s['name_ar'], s['curriculum'], s['school_type'],
          s['gender_policy'], s['district'], s['latitude'], s['longitude'], s['fees_min'],
          s['fees_max'], s['grades_offered'], s['language'], s['rating'],
          to_bool(s['bus_service']), to_bool(s['counseling']), to_bool(s['special_needs']),
          s['university_pathway'], s['website'], s['created_at']))
print(f"  {len(schools)} schools migrated")

# Migrate posts
print("Migrating posts...")
mysql_cursor.execute("SELECT * FROM posts")
posts = mysql_cursor.fetchall()
for p in posts:
    pg_cursor.execute("""
        INSERT INTO posts (post_id, school_id, caption, media_url, media_type, likes, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (post_id) DO NOTHING
    """, (p['post_id'], p['school_id'], p['caption'], p['media_url'], p['media_type'], p['likes'], p['created_at']))
print(f"  {len(posts)} posts migrated")

# Update sequences
pg_cursor.execute("SELECT setval('schools_school_id_seq', (SELECT MAX(school_id) FROM schools))")
pg_cursor.execute("SELECT setval('posts_post_id_seq', (SELECT MAX(post_id) FROM posts))")

pg_conn.commit()
pg_cursor.close()
pg_conn.close()
mysql_cursor.close()
mysql_conn.close()

print("Migration complete!")
