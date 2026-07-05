import os
import re
import unicodedata
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
    (r"স্থাপত্য ও পরিকল্পনা|স্হাপত্য ও পরিকল্পনা", "Architecture"),
    (r"নগর ও (অঞ্চল )?পরিকল্পনা|^পরিকল্পনা বিভাগ$|আই[,.\s]*উ[,.\s]*আর[,.\s]*পি|ইউ[,.\s]*আর[,.\s]*পি", "Urban and Regional Planning"),
    (r"পানিসম্পদ|পানি সম্পদ", "Water Resources Engineering"),
    (r"কেমিকেল ইনজিনিয়ারিং|^কেমিকৌশল বিভাগ", "Chemical Engineering"),
    (r"সিভিল ইনজিনিয়ারিং|^পুরকৌশল (বিভাগ|বিভা)|^প্রকৌশল অনুষদ$", "Civil Engineering"),
    (r"কেমিষ্ট্রি বিভাগ|^রসায়ন বিভাগ$", "Chemistry"),
    (r"^মানবিক বিভাগ$", "Humanities"),
    (r"ইলেকট্রিক্যাল ইনজিনিয়ারিং", "Electrical and Electronic Engineering"),
]
MERGE_RULES = [(unicodedata.normalize("NFC", p), t) for p, t in MERGE_RULES]


def decode_if_mojibake(s):
    try:
        fixed = s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s
    return fixed


def resolve_target(text):
    if not text:
        return None
    n = unicodedata.normalize("NFC", decode_if_mojibake(text))
    for pattern, target_name in MERGE_RULES:
        if re.search(pattern, n):
            return target_name
    return None


cur.execute("SELECT id, name_english FROM departments WHERE serial BETWEEN 1 AND 22")
originals = {o["name_english"]: o["id"] for o in cur.fetchall()}

# --- 1. Fix members: rejoin via legacy_member_id -> legacy_members.department ---
cur.execute(
    """SELECT m.id, lm.department FROM members m
       JOIN legacy_members lm ON lm.memberid = m.legacy_member_id
       WHERE m.department_id IS NULL"""
)
rows = cur.fetchall()
members_fixed = 0
for r in rows:
    target_name = resolve_target(r["department"])
    if target_name:
        target_id = originals[target_name]
        cur.execute("UPDATE members SET department_id=%s WHERE id=%s", (target_id, r["id"]))
        members_fixed += 1
conn.commit()
print(f"Members fixed: {members_fixed}")

# --- 2. Fix relational presentees via legacy_meetingmembers -> members (now corrected) ---
cur.execute(
    """
    UPDATE presentees p
    SET department_id = m.department_id
    FROM legacy_meetingmembers lmm
    JOIN members m ON m.legacy_member_id = lmm.memberid
    JOIN meetings mt ON mt.legacy_meeting_no = lmm.meetingno
    WHERE p.meeting_id = mt.id
      AND p.name = m.name
      AND p.designation IS NOT DISTINCT FROM m.designation
      AND p.department_id IS NULL
      AND m.department_id IS NOT NULL
    """
)
print("Relational presentees fixed:", cur.rowcount)
conn.commit()

# --- 3. Fix txtmembers-backfilled presentees by re-parsing legacy_meeting.txtmembers ---
def parse_txtmembers(raw):
    records = [r.strip() for r in raw.split(";") if r.strip()]
    parsed = []
    for r in records:
        parts = [p.strip() for p in r.split("#") if p.strip()]
        if not parts:
            continue
        if len(parts) >= 3:
            name, designation, department = parts[0], parts[1], " ".join(parts[2:])
        elif len(parts) == 2:
            name, designation, department = parts[0], None, parts[1]
        else:
            name, designation, department = parts[0], None, None
        parsed.append((name, designation, department))
    return parsed


cur.execute(
    """
    SELECT m.id AS meeting_id, lm.txtmembers
    FROM meetings m
    JOIN legacy_meeting lm ON lm.meetingno = m.legacy_meeting_no
    WHERE lm.txtmembers IS NOT NULL AND trim(lm.txtmembers) <> ''
    """
)
meetings = cur.fetchall()
txt_fixed = 0
for row in meetings:
    for name, designation, department in parse_txtmembers(row["txtmembers"]):
        target_name = resolve_target(department)
        if not target_name:
            continue
        target_id = originals[target_name]
        cur.execute(
            """UPDATE presentees SET department_id=%s
               WHERE meeting_id=%s AND name=%s AND designation IS NOT DISTINCT FROM %s
                 AND department_id IS NULL""",
            (target_id, row["meeting_id"], name[:255] if name else name, designation[:255] if designation else designation),
        )
        txt_fixed += cur.rowcount
conn.commit()
print("txtmembers-sourced presentees fixed:", txt_fixed)

cur.execute("SELECT COUNT(*) AS n FROM members WHERE department_id IS NULL")
print("Members still without department:", cur.fetchone()["n"])
cur.execute("SELECT COUNT(*) AS n FROM presentees WHERE department_id IS NULL")
print("Presentees still without department:", cur.fetchone()["n"])

cur.close()
conn.close()
