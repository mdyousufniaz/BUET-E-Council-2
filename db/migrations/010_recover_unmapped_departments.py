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

# 006/007 left rows unresolved whenever the UPDATE's exact
# `designation IS NOT DISTINCT FROM` match failed to line up, even though the
# department text itself was resolvable. This pass re-derives department_id
# by department text alone (dropping the designation match), and only writes
# when a presentee resolves to exactly one candidate department -- ambiguous
# cases (a name mapping to more than one department) are left untouched.

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
    (r"সিভিল ইনজিনিয়ারিং|^পুরকৌশল (বিভাগ|বিভা|অনুষদ)|^প্রকৌশল অনুষদ$", "Civil Engineering"),
    (r"কেমিষ্ট্রি বিভাগ|^রসায়ন বিভাগ$", "Chemistry"),
    (r"^মানবিক বিভাগ$", "Humanities"),
    (r"ইলেকট্রিক্যাল ইনজিনিয়ারিং", "Electrical and Electronic Engineering"),
    (r"^সি[.,\s]*এস[.,\s]*ই\b", "Computer Science and Engineering"),
    (r"^ত[.,\s]*ই[.,\s]*,?\s*কৌশল", "Electrical and Electronic Engineering"),
    (r"^পি[.,\s]*এম[.,\s]*আর[.,\s]*ই\b", "Petroleum and Mineral Resources Engineering"),
    (r"^যন্ত্রকৌশল বিভাগ বাপ্রবি", "Mechanical Engineering"),
]
MERGE_RULES = [(unicodedata.normalize("NFC", p), t) for p, t in MERGE_RULES]


def decode_if_mojibake(s):
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


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

# --- 1. Relational presentees: name+meeting match to an already-resolved
#         member, ignoring designation text differences. Skip if the name
#         resolves to more than one distinct department within the meeting.
cur.execute(
    """
    SELECT p.id, array_agg(DISTINCT m.department_id) AS candidates
    FROM presentees p, legacy_meetingmembers lmm
    JOIN members m ON m.legacy_member_id = lmm.memberid
    JOIN meetings mt ON mt.legacy_meeting_no = lmm.meetingno
    WHERE p.meeting_id = mt.id
      AND p.name = m.name
      AND p.department_id IS NULL
      AND m.department_id IS NOT NULL
    GROUP BY p.id
    """
)
relational_fixed = 0
relational_skipped_ambiguous = 0
for row in cur.fetchall():
    if len(row["candidates"]) == 1:
        cur.execute("UPDATE presentees SET department_id=%s WHERE id=%s", (row["candidates"][0], row["id"]))
        relational_fixed += 1
    else:
        relational_skipped_ambiguous += 1
conn.commit()
print(f"Relational presentees fixed: {relational_fixed} (skipped {relational_skipped_ambiguous} ambiguous)")


# --- 2. txtmembers-sourced presentees: same relaxation, resolved by
#         re-parsing legacy_meeting.txtmembers.
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
    SELECT p.id, p.name, lm.txtmembers
    FROM presentees p
    JOIN meetings m ON m.id = p.meeting_id
    JOIN legacy_meeting lm ON lm.meetingno = m.legacy_meeting_no
    WHERE p.department_id IS NULL AND lm.txtmembers IS NOT NULL
    """
)
txt_fixed = 0
txt_skipped_ambiguous = 0
for row in cur.fetchall():
    candidates = set()
    for name, designation, department in parse_txtmembers(row["txtmembers"]):
        if name == row["name"]:
            target_name = resolve_target(department)
            if target_name:
                candidates.add(originals[target_name])
    if len(candidates) == 1:
        cur.execute("UPDATE presentees SET department_id=%s WHERE id=%s", (next(iter(candidates)), row["id"]))
        txt_fixed += 1
    elif len(candidates) > 1:
        txt_skipped_ambiguous += 1
conn.commit()
print(f"txtmembers-sourced presentees fixed: {txt_fixed} (skipped {txt_skipped_ambiguous} ambiguous)")

cur.execute("SELECT COUNT(*) AS n FROM members WHERE department_id IS NULL")
print("Members still without department:", cur.fetchone()["n"])
cur.execute("SELECT COUNT(*) AS n FROM presentees WHERE department_id IS NULL")
print("Presentees still without department:", cur.fetchone()["n"])

cur.close()
conn.close()
