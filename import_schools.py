import openpyxl
import mysql.connector

conn = mysql.connector.connect(
    host="127.0.0.1",
    port=3306,
    user="root",
    database="school_recommender"
)
cursor = conn.cursor()

wb = openpyxl.load_workbook("/Users/ghaliabadokhon/Desktop/Jeddah_International_Schools.xlsx")
ws = wb["Jeddah International Schools"]

inserted = 0
skipped = 0

for row in ws.iter_rows(min_row=2, values_only=True):
    name_en = row[0]
    if not name_en:
        skipped += 1
        continue

    curriculum  = str(row[1]) if row[1] else None
    language    = str(row[2]) if row[2] else None
    grades      = str(row[4]) if row[4] else None
    gender      = str(row[4]) if row[4] else None

    fees_min_raw = row[5]
    fees_max_raw = row[6]
    fees_min = int(fees_min_raw) if isinstance(fees_min_raw, (int, float)) else None
    fees_max = int(fees_max_raw) if isinstance(fees_max_raw, (int, float)) else None

    district        = str(row[7])  if row[7]  else None
    grades_offered  = str(row[8])  if row[8]  else None
    accreditation   = str(row[9])  if row[9]  else None
    university      = str(row[17]) if row[17] else None
    website         = str(row[18]) if row[18] else None

    bus      = True if str(row[14]).strip().lower() == "yes" else False
    counsel  = True if str(row[15]).strip().lower() == "yes" else False
    special  = True if str(row[16]).strip().lower() == "yes" else False

    cursor.execute("""
        INSERT INTO schools (
            name_en, curriculum, language, gender_policy,
            fees_min, fees_max, district, grades_offered,
            university_pathway, website,
            bus_service, counseling, special_needs
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (
        name_en, curriculum, language, gender,
        fees_min, fees_max, district, grades_offered,
        university, website,
        bus, counsel, special
    ))
    inserted += 1

conn.commit()
cursor.close()
conn.close()

print(f"Done! {inserted} schools inserted, {skipped} rows skipped.")
