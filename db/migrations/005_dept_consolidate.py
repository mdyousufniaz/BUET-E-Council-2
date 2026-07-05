import os
import re
import psycopg2
import psycopg2.extras

conn = psycopg2.connect(
    host=os.environ.get("PGHOST", "172.21.0.3"),
    port=int(os.environ.get("PGPORT", "5432")),
    user=os.environ.get("PGUSER", "admin"),
    password=os.environ.get("PGPASSWORD", "buet_admin_pass"),
    dbname=os.environ.get("PGDATABASE", "ecouncil_db"),
)
conn.autocommit = False
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

def decode_if_mojibake(s):
    try:
        fixed = s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s
    return fixed

cur.execute("""
    SELECT id, serial, name_bangla,
           (SELECT COUNT(*) FROM members m WHERE m.department_id=d.id) AS members,
           (SELECT COUNT(*) FROM presentees p WHERE p.department_id=d.id) AS presentees,
           (SELECT COUNT(*) FROM agenda_departments ad WHERE ad.department_id=d.id) AS agenda_links
    FROM departments d WHERE serial > 22
""")
extras = cur.fetchall()

cur.execute("SELECT id, serial, name_english FROM departments WHERE serial BETWEEN 1 AND 22")
originals = {o["name_english"]: o["id"] for o in cur.fetchall()}

# target department name_english for merge rules
MERGE_RULES = [
    (r"তড়িৎ|ইলেক", "Electrical and Electronic Engineering"),
    (r"কম্পিউটার", "Computer Science and Engineering"),
    (r"ইন্ডাষ্ট্রিয়াল|ইন্ড্রাষ্ট্রিয়াল|আই[,.\s]*পি[,.\s]*ই", "Industrial and Production Engineering"),
    (r"এপ্রোপ্রিয়েট|এ্যপ্রোপ্রিয়েট|আই[,.\s]*এ[,.\s]*টি", "Institute of Appropriate Technology"),
    (r"ইনফরমেশন এন্ড কমিউনিকেশন|আই[,.\s]*আই[,.\s]*সি[,.\s]*টি", "Institute of Information and Communication Technology"),
    (r"বন্যা|আই[,.\s]*এফ[,.\s]*সি[,.\s]*ডি[,.\s]*আর|আই[,.\s]*ডব্লিউ[,.\s]*এফ[,.\s]*এম", "Institute of Water and Flood Management"),
    (r"পেট্রোলিয়াম|মিনারেল", "Petroleum and Mineral Resources Engineering"),
    (r"ধাতব|মেটালার্জিক্যাল", "Materials and Metallurgical Engineering"),
    (r"^গনিত বিভাগ$|^গণিত বিভাগ$", "Mathematics"),
    (r"পদার্থ", "Physics"),
    (r"ফিজিকস বিভাগ", "Physics"),
    (r"গ্লাস এন্ড সিরামিক", "Nanomaterials and Ceramic Engineering"),
    (r"যন্ত্র?কৌশল (অনুষদ|বিভাগ)$|যন্ত্রিকৌশল", "Mechanical Engineering"),
    (r"নৌ|জলযান", "Naval Architecture and Marine Engineering"),
    (r"আর্কিটেকচার|অস্থাপত্য|স্হাপত্য বিভাগ$|স্থাপত্য কৌশল বিভাগ|^স্থাপত্য বিভাগ$|^স্থাপত্য অনুষদ$", "Architecture"),
    (r"স্থাপত্য ও পরিকল্পনা|স্হাপত্য ও পরিকল্পনা", "Architecture"),  # user decision
    (r"নগর ও (অঞ্চল )?পরিকল্পনা|^পরিকল্পনা বিভাগ$|আই[,.\s]*উ[,.\s]*আর[,.\s]*পি|ইউ[,.\s]*আর[,.\s]*পি", "Urban and Regional Planning"),
    (r"পানিসম্পদ|পানি সম্পদ", "Water Resources Engineering"),
    (r"কেমিকেল ইনজিনিয়ারিং|^কেমিকৌশল বিভাগ", "Chemical Engineering"),
    (r"সিভিল ইনজিনিয়ারিং|^পুরকৌশল (বিভাগ|বিভা)|^প্রকৌশল অনুষদ$", "Civil Engineering"),  # user decision
    (r"কেমিষ্ট্রি বিভাগ|^রসায়ন বিভাগ$", "Chemistry"),
    (r"^মানবিক বিভাগ$", "Humanities"),
    (r"ইলেকট্রিক্যাল ইনজিনিয়ারিং", "Electrical and Electronic Engineering"),
]

DELETE_ONLY = None  # everything not matched by a rule gets deleted

merged = 0
deleted = 0
kept_ambiguous = []

for e in extras:
    name = decode_if_mojibake(e["name_bangla"] or "")
    target_id = None
    for pattern, target_name in MERGE_RULES:
        if re.search(pattern, name):
            target_id = originals.get(target_name)
            break

    if target_id:
        cur.execute("UPDATE members SET department_id=%s WHERE department_id=%s", (target_id, e["id"]))
        cur.execute("UPDATE presentees SET department_id=%s WHERE department_id=%s", (target_id, e["id"]))
        # avoid PK collisions on (agenda_id, department_id) before repointing
        cur.execute(
            """DELETE FROM agenda_departments ad USING agenda_departments ad2
               WHERE ad.department_id=%s AND ad2.department_id=%s AND ad.agenda_id=ad2.agenda_id""",
            (e["id"], target_id),
        )
        cur.execute("UPDATE agenda_departments SET department_id=%s WHERE department_id=%s", (target_id, e["id"]))
        cur.execute("DELETE FROM departments WHERE id=%s", (e["id"],))
        merged += 1
    else:
        cur.execute("DELETE FROM departments WHERE id=%s", (e["id"],))
        deleted += 1

conn.commit()
print(f"Merged into originals: {merged}")
print(f"Deleted (no match): {deleted}")

cur.execute("SELECT COUNT(*) AS n FROM departments")
print("Final department count:", cur.fetchone()["n"])

cur.close()
conn.close()
