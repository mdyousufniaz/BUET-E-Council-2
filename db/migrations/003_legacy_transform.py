import os
import psycopg2
import psycopg2.extras
import unicodedata
import bcrypt
import random
import string

# Transforms data already loaded into legacy_* staging tables (see 001_legacy_staging.sql
# + acq_parse.py) into the live application schema. Safe to re-run: departments/members/
# meetings/agenda/categories/users are upserted by legacy id; presentees are only inserted
# if the table is currently empty (no natural legacy key to dedupe against).
#
# Connection: set PG_HOST (defaults to the buet-e-council-2-db-1 container's bridge IP,
# useful when running from the host without a published 5432 port) and the usual PG_* env
# vars, or point DATABASE_URL at the db container from anywhere on its docker network.
conn = psycopg2.connect(
    host=os.environ.get("PGHOST", "127.0.0.1"),
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
    return "".join(s.split())  # strip all whitespace


report = {}

def log(key, n):
    report[key] = report.get(key, 0) + n


# ---------------------------------------------------------------
# 1. Departments: match legacy departments to seeded ones, insert unmatched
# ---------------------------------------------------------------
cur.execute("SELECT id, name_bangla, name_english, alias_bangla FROM departments")
dept_rows = cur.fetchall()

name_to_id = {}
for r in dept_rows:
    for key in (r["name_bangla"], r["name_english"], r["alias_bangla"]):
        if key:
            name_to_id[norm(key)] = r["id"]

cur.execute("SELECT departmentid, departmentname FROM legacy_departments")
legacy_depts = cur.fetchall()

legacy_dept_id_to_new = {}
unmatched_depts = 0
matched_depts = 0
next_serial_cur = cur
cur.execute("SELECT COALESCE(MAX(serial), 0) AS m FROM departments")
next_serial = cur.fetchone()["m"] + 1

for d in legacy_depts:
    key = norm(d["departmentname"])
    new_id = name_to_id.get(key)
    if new_id:
        matched_depts += 1
        cur.execute(
            "UPDATE departments SET legacy_department_id = %s WHERE id = %s AND legacy_department_id IS NULL",
            (d["departmentid"], new_id),
        )
    else:
        cur.execute(
            """INSERT INTO departments (serial, name_bangla, legacy_department_id)
               VALUES (%s, %s, %s) RETURNING id""",
            (next_serial, d["departmentname"], d["departmentid"]),
        )
        new_id = cur.fetchone()["id"]
        next_serial += 1
        unmatched_depts += 1
        name_to_id[key] = new_id
    legacy_dept_id_to_new[d["departmentid"]] = new_id

log("departments_matched_to_existing", matched_depts)
log("departments_inserted_new", unmatched_depts)

# department aliases -> extra lookup keys (not written back to alias_bangla, just used for member matching)
cur.execute("SELECT departmentid, departmentalias FROM legacy_departmentalias")
for r in cur.fetchall():
    new_id = legacy_dept_id_to_new.get(r["departmentid"])
    if new_id:
        name_to_id[norm(r["departmentalias"])] = new_id

conn.commit()
print("Departments done:", matched_depts, "matched,", unmatched_depts, "inserted new")

# ---------------------------------------------------------------
# 2. Members
# ---------------------------------------------------------------
cur.execute("SELECT memberid, membername, designation, department FROM legacy_members")
legacy_members = cur.fetchall()

legacy_member_id_to_new = {}
members_unmatched_dept = 0
for m in legacy_members:
    dept_id = None
    if m["department"]:
        dept_id = name_to_id.get(norm(m["department"]))
        if dept_id is None:
            # leave nothing behind: create a department row for genuinely new department text
            cur.execute(
                """INSERT INTO departments (serial, name_bangla, legacy_department_id)
                   VALUES (%s, %s, NULL) RETURNING id""",
                (next_serial, m["department"]),
            )
            dept_id = cur.fetchone()["id"]
            next_serial += 1
            name_to_id[norm(m["department"])] = dept_id
            members_unmatched_dept += 1
    # a handful of legacy rows are ex-officio slots (e.g. "Dean") with no personal
    # name recorded; fall back to designation + department so nothing is dropped
    name = m["membername"] or " - ".join(filter(None, [m["designation"], m["department"]])) or "অজ্ঞাত সদস্য"
    cur.execute(
        """INSERT INTO members (name, designation, department_id, member_type, legacy_member_id)
           VALUES (%s, %s, %s, 'academic', %s)
           ON CONFLICT (legacy_member_id) DO NOTHING
           RETURNING id""",
        (name, m["designation"], dept_id, m["memberid"]),
    )
    row = cur.fetchone()
    if row:
        legacy_member_id_to_new[m["memberid"]] = row["id"]
    else:
        cur.execute("SELECT id FROM members WHERE legacy_member_id = %s", (m["memberid"],))
        legacy_member_id_to_new[m["memberid"]] = cur.fetchone()["id"]

conn.commit()
log("members_inserted", len(legacy_member_id_to_new))
log("departments_created_from_member_text", members_unmatched_dept)
print("Members done:", len(legacy_member_id_to_new), "; new depts from member free-text:", members_unmatched_dept)

# ---------------------------------------------------------------
# 3. Meetings (+ extra dates)
# ---------------------------------------------------------------
cur.execute("SELECT meetingno, txtmembers FROM legacy_meeting")
legacy_meetings = cur.fetchall()

cur.execute("SELECT meetingno, meetingdate FROM legacy_meetingdates ORDER BY meetingno, meetingdate")
dates_by_meeting = {}
for r in cur.fetchall():
    dates_by_meeting.setdefault(r["meetingno"], []).append(r["meetingdate"])

legacy_meeting_no_to_new = {}
extra_dates_count = 0
for m in legacy_meetings:
    dates = dates_by_meeting.get(m["meetingno"], [])
    primary_date = min(dates) if dates else None
    title = f"একাডেমিক কাউন্সিল অধিবেশন নং {int(m['meetingno'])}"
    cur.execute(
        """INSERT INTO meetings (title, description, meeting_date, is_locked, type, status, legacy_meeting_no)
           VALUES (%s, %s, %s, TRUE, 'academic', 'past', %s)
           ON CONFLICT (legacy_meeting_no) DO NOTHING
           RETURNING id""",
        (title, m["txtmembers"], primary_date, m["meetingno"]),
    )
    row = cur.fetchone()
    is_new_meeting = bool(row)
    if row:
        new_id = row["id"]
    else:
        cur.execute("SELECT id FROM meetings WHERE legacy_meeting_no = %s", (m["meetingno"],))
        new_id = cur.fetchone()["id"]
    legacy_meeting_no_to_new[m["meetingno"]] = new_id

    if is_new_meeting:
        for extra in dates[1:]:
            cur.execute(
                "INSERT INTO meeting_extra_dates (meeting_id, meeting_date) VALUES (%s, %s)",
                (new_id, extra),
            )
            extra_dates_count += 1

conn.commit()
log("meetings_inserted", len(legacy_meeting_no_to_new))
log("meeting_extra_dates_inserted", extra_dates_count)
print("Meetings done:", len(legacy_meeting_no_to_new), "; extra sitting dates:", extra_dates_count)

# ---------------------------------------------------------------
# 4. Agenda + meetingagendas link + appendix->annexures
# ---------------------------------------------------------------
cur.execute("SELECT agendaid, meetingno FROM legacy_meetingagendas")
agenda_to_meetingno = {}
for r in cur.fetchall():
    agenda_to_meetingno[r["agendaid"]] = r["meetingno"]

cur.execute("SELECT agendaid, proposal, decision, appendix, nod FROM legacy_agendas")
legacy_agendas = cur.fetchall()

legacy_agenda_id_to_new = {}
annexures_count = 0
for a in legacy_agendas:
    meetingno = agenda_to_meetingno.get(a["agendaid"])
    meeting_id = legacy_meeting_no_to_new.get(meetingno) if meetingno is not None else None
    is_executed = True if a["nod"] == "yes" else (False if a["nod"] == "no" else None)
    serial = None
    tail = a["agendaid"][-2:] if a["agendaid"] else None
    if tail and tail.isdigit():
        serial = int(tail)
    cur.execute(
        """INSERT INTO agenda (content, resolution, is_executed, agenda_serial, meeting_id, legacy_agenda_id)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (legacy_agenda_id) DO NOTHING
           RETURNING id""",
        (a["proposal"], a["decision"], is_executed, serial, meeting_id, a["agendaid"]),
    )
    row = cur.fetchone()
    is_new_agenda = bool(row)
    if row:
        new_id = row["id"]
    else:
        cur.execute("SELECT id FROM agenda WHERE legacy_agenda_id = %s", (a["agendaid"],))
        new_id = cur.fetchone()["id"]
    legacy_agenda_id_to_new[a["agendaid"]] = new_id

    if is_new_agenda and a["appendix"]:
        cur.execute(
            """INSERT INTO annexures (content_id, annexure_type, summary)
               VALUES (%s, 'agendaItem', %s)""",
            (new_id, a["appendix"]),
        )
        annexures_count += 1

conn.commit()
log("agenda_inserted", len(legacy_agenda_id_to_new))
log("annexures_from_appendix", annexures_count)
print("Agenda done:", len(legacy_agenda_id_to_new), "; annexures from appendix:", annexures_count)

# ---------------------------------------------------------------
# 5. Categories + agenda_categories + agenda_departments
# ---------------------------------------------------------------
cur.execute("SELECT categoryid, categoryname FROM legacy_categories")
legacy_cat_id_to_new = {}
for c in cur.fetchall():
    cur.execute(
        """INSERT INTO categories (legacy_category_id, name) VALUES (%s, %s)
           ON CONFLICT (legacy_category_id) DO NOTHING RETURNING id""",
        (c["categoryid"], c["categoryname"] or f"Category {c['categoryid']}"),
    )
    row = cur.fetchone()
    if row:
        legacy_cat_id_to_new[c["categoryid"]] = row["id"]
    else:
        cur.execute("SELECT id FROM categories WHERE legacy_category_id = %s", (c["categoryid"],))
        legacy_cat_id_to_new[c["categoryid"]] = cur.fetchone()["id"]
conn.commit()
log("categories_inserted", len(legacy_cat_id_to_new))

cur.execute("SELECT DISTINCT agendaid, categoryid FROM legacy_agendacategories")
ac_count = 0
ac_skipped = 0
for r in cur.fetchall():
    agenda_id = legacy_agenda_id_to_new.get(r["agendaid"])
    category_id = legacy_cat_id_to_new.get(int(r["categoryid"]))
    if agenda_id and category_id:
        cur.execute(
            "INSERT INTO agenda_categories (agenda_id, category_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (agenda_id, category_id),
        )
        ac_count += 1
    else:
        ac_skipped += 1
conn.commit()
log("agenda_categories_inserted", ac_count)
log("agenda_categories_skipped_unresolved", ac_skipped)
print("agenda_categories:", ac_count, "linked,", ac_skipped, "skipped (unresolved refs)")

cur.execute("SELECT DISTINCT agendaid, departmentid FROM legacy_agendadepartments WHERE agendaid IS NOT NULL AND departmentid IS NOT NULL")
ad_count = 0
ad_skipped = 0
for r in cur.fetchall():
    agenda_id = legacy_agenda_id_to_new.get(r["agendaid"])
    department_id = legacy_dept_id_to_new.get(int(r["departmentid"]))
    if agenda_id and department_id:
        cur.execute(
            "INSERT INTO agenda_departments (agenda_id, department_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (agenda_id, department_id),
        )
        ad_count += 1
    else:
        ad_skipped += 1
conn.commit()
log("agenda_departments_inserted", ad_count)
log("agenda_departments_skipped_unresolved", ad_skipped)
print("agenda_departments:", ad_count, "linked,", ad_skipped, "skipped (unresolved refs)")

# ---------------------------------------------------------------
# 6. Presentees from meetingmembers
# ---------------------------------------------------------------
cur.execute("SELECT legacy_member_id, name, designation, department_id FROM members WHERE legacy_member_id IS NOT NULL")
member_info = {r["legacy_member_id"]: r for r in cur.fetchall()}

cur.execute("SELECT COUNT(*) AS n FROM presentees")
already_have_presentees = cur.fetchone()["n"] > 0

cur.execute("SELECT meetingno, memberid FROM legacy_meetingmembers")
rows_to_process = [] if already_have_presentees else cur.fetchall()
presentees_count = 0
presentees_skipped = 0
for r in rows_to_process:
    meeting_id = legacy_meeting_no_to_new.get(r["meetingno"])
    minfo = member_info.get(r["memberid"])
    if meeting_id and minfo:
        cur.execute(
            """INSERT INTO presentees (name, designation, department_id, meeting_id)
               VALUES (%s, %s, %s, %s)""",
            (minfo["name"], minfo["designation"], minfo["department_id"], meeting_id),
        )
        presentees_count += 1
    else:
        presentees_skipped += 1
conn.commit()
log("presentees_inserted", presentees_count)
log("presentees_skipped_unresolved", presentees_skipped)
print("presentees:", presentees_count, "inserted,", presentees_skipped, "skipped (unresolved refs)")

# ---------------------------------------------------------------
# 7. Users (password reset required, role remapped)
# ---------------------------------------------------------------
role_map = {"lead": "admin", "supervisor": "moderator", "operator": "member"}
cur.execute("SELECT username, password, role FROM legacy_users")
users_count = 0
for u in cur.fetchall():
    new_role = role_map.get((u["role"] or "").strip().lower(), "member")
    random_pw = "".join(random.choices(string.ascii_letters + string.digits, k=24))
    pw_hash = bcrypt.hashpw(random_pw.encode(), bcrypt.gensalt()).decode()
    cur.execute(
        """INSERT INTO users (username, password, role, status, legacy_username)
           VALUES (%s, %s, %s, 'inactive', %s)
           ON CONFLICT (username) DO NOTHING""",
        (u["username"], pw_hash, new_role, u["username"]),
    )
    users_count += cur.rowcount
conn.commit()
log("users_inserted", users_count)
print("users:", users_count, "inserted (status=inactive, password reset required before use)")

print("\n=== SUMMARY ===")
for k, v in report.items():
    print(f"{k}: {v}")

cur.close()
conn.close()
