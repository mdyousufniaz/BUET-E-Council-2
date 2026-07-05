import os
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


def fix_if_mojibake(s):
    """Undo Bangla UTF-8 bytes that were round-tripped through Latin-1
    (the same corruption 005/006/007 already correct for department names,
    but 003_legacy_transform.py never applied it to member name/designation)."""
    if not s or all(ord(c) < 128 for c in s):
        return None
    try:
        fixed = s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    if fixed == s:
        return None
    if not any("ঀ" <= c <= "৿" for c in fixed):
        return None
    return fixed


def fix_table(table, columns, id_col="id"):
    cur.execute(f"SELECT {id_col}, {', '.join(columns)} FROM {table}")
    rows = cur.fetchall()
    fixed_count = 0
    for row in rows:
        updates = {}
        for col in columns:
            fixed = fix_if_mojibake(row[col])
            if fixed:
                updates[col] = fixed
        if updates:
            set_clause = ", ".join(f"{c} = %s" for c in updates)
            cur.execute(
                f"UPDATE {table} SET {set_clause} WHERE {id_col} = %s",
                [*updates.values(), row[id_col]],
            )
            fixed_count += 1
    print(f"{table}: fixed {fixed_count} rows")


fix_table("members", ["name", "designation", "prefix"])
fix_table("legacy_members", ["membername", "designation", "department"], id_col="memberid")

conn.commit()
cur.close()
conn.close()
