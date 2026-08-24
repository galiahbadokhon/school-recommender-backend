import mysql.connector

conn = mysql.connector.connect(
    host="127.0.0.1",
    port=3306,
    user="root",
    database="school_recommender"
)
cursor = conn.cursor()

schools = [
    ("British International School of Jeddah (BiSJ)", 21.5796, 39.1601, 4.8),
    ("Jeddah Prep and Grammar School",                21.5433, 39.1728, 4.5),
    ("Al-Hekma International School",                 21.5580, 39.1950, 4.0),
    ("Al Afkar International School",                 21.5300, 39.2100, 3.8),
    ("Al Rawdah International School",                21.5620, 39.1880, 3.9),
    ("Hera International School",                     21.5500, 39.1750, 3.7),
    ("Al Waha International School",                  21.6100, 39.1500, 3.8),
    ("The Continental School",                        21.5200, 39.2200, 3.6),
    ("Al Hejaz International School (HIS)",           21.5450, 39.1900, 3.7),
    ("Sherborne School Jeddah",                       21.6800, 39.1200, 4.7),
    ("American International School of Jeddah (AISJ)",21.5900, 39.1100, 4.9),
    ("Jeddah Private International School (JPIS)",    21.5620, 39.1880, 4.2),
    ("Advanced Generations International School",     21.5300, 39.2100, 3.8),
    ("Dar Jana International School",                 21.5480, 39.1820, 3.7),
    ("International Schools Group (ISG) Jeddah",      21.6700, 39.1300, 4.6),
    ("Jeddah Knowledge International School (JKS)",   21.5520, 39.1760, 4.4),
    ("Al-Kawthar International Schools",              21.5600, 39.1900, 4.3),
    ("Bright Minds International School (BMIS)",      21.6600, 39.1400, 4.1),
    ("Nün Academy",                                   21.6500, 39.1350, 4.2),
    ("Jeddah International School (JIS)",             21.5580, 39.1870, 4.3),
    ("Al Manarat International School",               21.5310, 39.2080, 3.9),
    ("Cedar International School",                    21.6050, 39.1520, 4.0),
    ("Thamer International Schools (TIS)",            21.5640, 39.1910, 4.1),
    ("Nahda Academy",                                 21.5150, 39.2180, 3.6),
    ("Pakistan International School Jeddah (PISJES)", 21.5200, 39.2150, 3.8),
    ("Indian International School Jeddah",            21.5580, 39.1920, 3.7),
    ("Al Rowad International School",                 21.6750, 39.1250, 3.9),
    ("Jeddah Campus International School (JCS)",      21.6600, 39.1380, 3.8),
    ("Al-Rehab International School",                 21.5450, 39.1850, 3.7),
    ("Gem American School Jeddah",                    21.6020, 39.1540, 4.2),
]

updated = 0
for name, lat, lng, rating in schools:
    cursor.execute("""
        UPDATE schools
        SET latitude = %s, longitude = %s, rating = %s
        WHERE name_en = %s
    """, (lat, lng, rating, name))
    updated += cursor.rowcount

conn.commit()
cursor.close()
conn.close()
print(f"Updated {updated} schools with coordinates and ratings!")
