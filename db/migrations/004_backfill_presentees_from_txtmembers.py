import os
import psycopg2
import psycopg2.extras
import unicodedata

conn = psycopg2.connect(
    host=os.environ.get("PGHOST", "172.21.0.3"),
    port=int(os.environ.get("PGPORT", "5432")),
    user=os.environ.get("PGUSER", "admin"),
    password=os.environ.get("PGPASSWORD", "buet_admin_pass"),
    dbname=os.environ.get("PGDATABASE", "ecouncil_db"),
)
conn.autocommit = False
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


def norm(s):
    if s is None:
        return None
    s = unicodedata.normalize("NFC", s)
    return "".join(s.split())


# department lookup, same approach as 003_legacy_transform.py
cur.execute("SELECT id, name_bangla, name_english, alias_bangla FROM departments")
name_to_id = {}
for r in cur.fetchall():
    for key in (r["name_bangla"], r["name_english"], r["alias_bangla"]):
        if key:
            name_to_id[norm(key)] = r["id"]

cur.execute("SELECT COALESCE(MAX(serial), 0) AS m FROM departments")
next_serial = cur.fetchone()["m"] + 1


def resolve_department(text):
    global next_serial
    if not text:
        return None
    key = norm(text)
    dept_id = name_to_id.get(key)
    if dept_id:
        return dept_id
    cur.execute(
        "INSERT INTO departments (serial, name_bangla) VALUES (%s, %s) RETURNING id",
        (next_serial, text.strip()[:255]),
    )
    dept_id = cur.fetchone()["id"]
    next_serial += 1
    name_to_id[key] = dept_id
    return dept_id


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


# meetings that only have txtmembers (no relational presentees at all)
cur.execute(
    """
    SELECT m.id AS meeting_id, lm.txtmembers
    FROM meetings m
    JOIN legacy_meeting lm ON lm.meetingno = m.legacy_meeting_no
    WHERE lm.txtmembers IS NOT NULL AND trim(lm.txtmembers) <> ''
      AND NOT EXISTS (SELECT 1 FROM presentees p WHERE p.meeting_id = m.id)
    """
)
targets = cur.fetchall()
print("meetings to backfill from txtmembers:", len(targets))

inserted = 0
meetings_touched = 0
for row in targets:
    entries = parse_txtmembers(row["txtmembers"])
    if not entries:
        continue
    meetings_touched += 1
    for name, designation, department in entries:
        dept_id = resolve_department(department)
        cur.execute(
            """INSERT INTO presentees (name, designation, department_id, meeting_id)
               VALUES (%s, %s, %s, %s)""",
            (name[:255] if name else name, designation[:255] if designation else designation, dept_id, row["meeting_id"]),
        )
        inserted += 1

conn.commit()
print(f"Backfilled {inserted} presentees across {meetings_touched} meetings")

# The raw "Name#Designation#Dept;..." blob was only ever dumped into description
# by the original migration; now that it's parsed into presentees, clear it so
# the meeting page doesn't render the hash-separated text as a description.
cur.execute(
    """
    UPDATE meetings m SET description = NULL
    FROM legacy_meeting lm
    WHERE lm.meetingno = m.legacy_meeting_no
      AND lm.txtmembers IS NOT NULL AND trim(lm.txtmembers) <> ''
    """
)
print("Cleared raw txtmembers dump from description for", cur.rowcount, "meetings")
conn.commit()

cur.close()
conn.close()
