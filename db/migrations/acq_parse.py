import re, csv, json, os, sys

# Parses the ACQ.sql Oracle dump into one CSV per legacy table (db/migrations/legacy_csv/),
# ready to load into the legacy_* staging tables from 001_legacy_staging.sql via `\copy`.
SRC = os.path.join(os.path.dirname(__file__), "..", "..", "ACQ.sql")
OUTDIR = os.path.join(os.path.dirname(__file__), "legacy_csv")
os.makedirs(OUTDIR, exist_ok=True)

# column order per table, taken from the CREATE TABLE defs already inspected
COLUMNS = {
    "ACQCONNECTION": ["VAL"],
    "AGENDACATEGORIES": ["AGENDAID", "CATEGORYID"],
    "AGENDADEPARTMENTS": ["AGENDAID", "DEPARTMENTID"],
    "AGENDAERRORS": ["MEETINGNO", "AGENDAID", "NAME", "EMAIL", "INWHERE", "DESCRIPTION", "EDATE"],
    "AGENDAFILES": ["AGENDAID", "FILENAME"],
    "AGENDALINKS": ["AGENDAID", "LINKDATA"],
    "AGENDAS": ["AGENDAID", "PROPOSAL", "DECISION", "APPENDIX", "NOD"],
    "AGENDATABLES": ["AGENDAID", "TABLEDATA"],
    "BACKMEMBERS": ["MEMBERID", "MEMBERNAME", "DESIGNATION", "DEPARTMENT"],
    "CATEGORIES": ["CATEGORYID", "CATEGORYNAME"],
    "CATEGORYLEVEL": ["PARENTID", "CHILDID"],
    "COMMENTS": ["NAME", "EMAIL", "COMMENTS", "CDATE"],
    "DEPARTMENTALIAS": ["DEPARTMENTID", "DEPARTMENTALIAS"],
    "DEPARTMENTS": ["DEPARTMENTID", "DEPARTMENTNAME", "RANK"],
    "MEETING": ["MEETINGNO", "INITIALS", "TXTMEMBERS"],
    "MEETINGAGENDAS": ["MEETINGNO", "AGENDAID"],
    "MEETINGDATES": ["MEETINGNO", "MEETINGDATE"],
    "MEETINGFILES": ["MEETINGNO", "FILENAME"],
    "MEETINGMEMBERS": ["MEETINGNO", "MEMBERID"],
    "MEETINGUSERS": ["MEETINGNO", "SUPERVISORNAME", "OPERATORNAME", "OSTATUS", "SSTATUS", "LSTATUS", "ASTATUS", "MSTATUS"],
    "MEETINGVIEW": ["MEETINGNO", "VIEWNO"],
    "MEMBERS": ["MEMBERID", "MEMBERNAME", "DESIGNATION", "DEPARTMENT"],
    "PRINTDATA": ["AGENDAID", "PROPOSAL", "DECISION", "APPENDIX", "FILES"],
    "TEMPAC": ["AGENDAID", "CATEGORYID"],
    "TEMPAGENDACATEGORIES": ["AGENDAID", "CATEGORYID"],
    "TEMPAGENDAS": ["NAME"],
    "TMPMEMBERS": ["ID", "POS"],
    "TMPNAMES": ["ID", "MEMBERNAME"],
    "USERS": ["USERNAME", "PASSWORD", "ROLE"],
}

TO_DATE_RE = re.compile(r"^TO_DATE\('([^']*)',\s*'[^']*'\)$")

def split_top_level(s):
    """Split a VALUES(...) inner string into top-level comma-separated tokens,
    respecting quoted strings ('' escape) and nested parens."""
    tokens = []
    buf = []
    in_str = False
    depth = 0
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if in_str:
            if c == "'":
                if i + 1 < n and s[i+1] == "'":
                    buf.append("''")
                    i += 2
                    continue
                else:
                    in_str = False
                    buf.append(c)
                    i += 1
                    continue
            else:
                buf.append(c)
                i += 1
                continue
        else:
            if c == "'":
                in_str = True
                buf.append(c)
                i += 1
                continue
            elif c == '(':
                depth += 1
                buf.append(c)
                i += 1
                continue
            elif c == ')':
                depth -= 1
                buf.append(c)
                i += 1
                continue
            elif c == ',' and depth == 0:
                tokens.append(''.join(buf))
                buf = []
                i += 1
                continue
            else:
                buf.append(c)
                i += 1
                continue
    tokens.append(''.join(buf))
    return tokens

def decode_value(tok):
    tok = tok.strip()
    if tok == "NULL":
        return None
    m = TO_DATE_RE.match(tok)
    if m:
        return m.group(1)  # 'YYYY-MM-DD HH24:MI:SS' as plain string, postgres can cast
    if tok.startswith("'") and tok.endswith("'"):
        inner = tok[1:-1]
        return inner.replace("''", "'")
    return tok  # bare number

def extract_values_list(text, start_paren_idx):
    """Given index of the opening '(' right after VALUES, scan forward tracking
    string/paren state until the matching closing paren. Return (inner_string, end_idx_after_close_paren)."""
    n = len(text)
    i = start_paren_idx + 1
    depth = 1
    in_str = False
    start_inner = i
    while i < n:
        c = text[i]
        if in_str:
            if c == "'":
                if i + 1 < n and text[i+1] == "'":
                    i += 2
                    continue
                else:
                    in_str = False
                    i += 1
                    continue
            else:
                i += 1
                continue
        else:
            if c == "'":
                in_str = True
                i += 1
                continue
            elif c == '(':
                depth += 1
                i += 1
                continue
            elif c == ')':
                depth -= 1
                if depth == 0:
                    inner = text[start_inner:i]
                    return inner, i + 1
                i += 1
                continue
            else:
                i += 1
                continue
    raise ValueError("Unterminated statement starting near %d" % start_paren_idx)

def main():
    with open(SRC, encoding="utf-8", errors="replace") as f:
        text = f.read()

    pattern = re.compile(r'INSERT INTO "ACQ"\."([A-Z0-9_]+)" VALUES \(')
    writers = {}
    files = {}
    counts = {}
    errors = []

    pos = 0
    n = len(text)
    total = 0
    for m in pattern.finditer(text):
        table = m.group(1)
        open_paren_idx = m.end() - 1  # index of '('
        try:
            inner, end_idx = extract_values_list(text, open_paren_idx)
        except ValueError as e:
            errors.append(str(e))
            continue
        tokens = split_top_level(inner)
        cols = COLUMNS.get(table)
        if cols is None:
            continue
        if len(tokens) != len(cols):
            errors.append(f"{table}: expected {len(cols)} cols got {len(tokens)} at pos {m.start()}: {inner[:120]}")
            continue
        values = [decode_value(t) for t in tokens]

        if table not in writers:
            fpath = os.path.join(OUTDIR, table.lower() + ".csv")
            fh = open(fpath, "w", newline="", encoding="utf-8")
            w = csv.writer(fh, quoting=csv.QUOTE_MINIMAL)
            writers[table] = w
            files[table] = fh
            counts[table] = 0
        writers[table].writerow(["" if v is None else v for v in values])
        counts[table] += 1
        total += 1

    for fh in files.values():
        fh.close()

    print("TOTAL ROWS:", total)
    print(json.dumps(counts, indent=2, ensure_ascii=False))
    print("ERRORS:", len(errors))
    for e in errors[:20]:
        print(" -", e)

if __name__ == "__main__":
    main()
