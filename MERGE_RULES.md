# Department Merge Rules

Consolidated reference for the `MERGE_RULES` regex-to-department mapping used
across the legacy department consolidation migrations:

- `db/migrations/005_dept_consolidate.py` — original merge of duplicate/legacy department rows (serial > 22) into the 22 canonical departments.
- `db/migrations/006_fix_nfc_normalization_bug.py` — same rule set, applied with NFC-normalized/mojibake-decoded input text to backfill `members`/`presentees` department links.
- `db/migrations/007_fix_missed_regex_patterns.py` — same rule set plus 4 additional patterns for department strings the earlier passes missed.
- `db/migrations/010_recover_unmapped_departments.py` — reuses the 007 rule set to resolve remaining unmatched `presentees` via relational/txtmembers fallback, skipping ambiguous matches.

Rules are matched **in order** with `re.search` against the (mojibake-decoded,
NFC-normalized) legacy department text; the first matching pattern wins.

## Final consolidated rule set (as of migration 010)

| # | Pattern | Target Department (`name_english`) | Notes |
|---|---------|-------------------------------------|-------|
| 1 | `তড়িৎ\|ইলেক` | Electrical and Electronic Engineering | |
| 2 | `কম্পিউটার` | Computer Science and Engineering | |
| 3 | `ইন্ডাষ্ট্রিয়াল\|ইন্ড্রাষ্ট্রিয়াল\|আই[,.\s]*পি[,.\s]*ই` | Industrial and Production Engineering | |
| 4 | `এপ্রোপ্রিয়েট\|এ্যপ্রোপ্রিয়েট\|আই[,.\s]*এ[,.\s]*টি` | Institute of Appropriate Technology | |
| 5 | `ইনফরমেশন এন্ড কমিউনিকেশন\|আই[,.\s]*আই[,.\s]*সি[,.\s]*টি` | Institute of Information and Communication Technology | |
| 6 | `বন্যা\|আই[,.\s]*এফ[,.\s]*সি[,.\s]*ডি[,.\s]*আর\|আই[,.\s]*ডব্লিউ[,.\s]*এফ[,.\s]*এম` | Institute of Water and Flood Management | |
| 7 | `পেট্রোলিয়াম\|মিনারেল` | Petroleum and Mineral Resources Engineering | |
| 8 | `ধাতব\|মেটালার্জিক্যাল` | Materials and Metallurgical Engineering | |
| 9 | `^গনিত বিভাগ$\|^গণিত বিভাগ$` | Mathematics | |
| 10 | `পদার্থ` | Physics | |
| 11 | `ফিজিকস বিভাগ` | Physics | |
| 12 | `গ্লাস এন্ড সিরামিক` | Nanomaterials and Ceramic Engineering | |
| 13 | `যন্ত্র?কৌশল (অনুষদ\|বিভাগ)$\|যন্ত্রিকৌশল` | Mechanical Engineering | |
| 14 | `নৌ\|জলযান` | Naval Architecture and Marine Engineering | |
| 15 | `আর্কিটেকচার\|অস্থাপত্য\|স্হাপত্য বিভাগ$\|স্থাপত্য কৌশল বিভাগ\|^স্থাপত্য বিভাগ$\|^স্থাপত্য অনুষদ$` | Architecture | |
| 16 | `স্থাপত্য ও পরিকল্পনা\|স্হাপত্য ও পরিকল্পনা` | Architecture | user decision |
| 17 | `নগর ও (অঞ্চল )?পরিকল্পনা\|^পরিকল্পনা বিভাগ$\|আই[,.\s]*উ[,.\s]*আর[,.\s]*পি\|ইউ[,.\s]*আর[,.\s]*পি` | Urban and Regional Planning | |
| 18 | `পানিসম্পদ\|পানি সম্পদ` | Water Resources Engineering | |
| 19 | `কেমিকেল ইনজিনিয়ারিং\|^কেমিকৌশল বিভাগ` | Chemical Engineering | |
| 20 | `সিভিল ইনজিনিয়ারিং\|^পুরকৌশল (বিভাগ\|বিভা\|অনুষদ)\|^প্রকৌশল অনুষদ$` | Civil Engineering | user decision |
| 21 | `কেমিষ্ট্রি বিভাগ\|^রসায়ন বিভাগ$` | Chemistry | |
| 22 | `^মানবিক বিভাগ$` | Humanities | |
| 23 | `ইলেকট্রিক্যাল ইনজিনিয়ারিং` | Electrical and Electronic Engineering | |
| 24 | `^সি[.,\s]*এস[.,\s]*ই\b` | Computer Science and Engineering | added in 007 |
| 25 | `^ত[.,\s]*ই[.,\s]*,?\s*কৌশল` | Electrical and Electronic Engineering | added in 007 |
| 26 | `^পি[.,\s]*এম[.,\s]*আর[.,\s]*ই\b` | Petroleum and Mineral Resources Engineering | added in 007 |
| 27 | `^যন্ত্রকৌশল বিভাগ বাপ্রবি` | Mechanical Engineering | added in 007 |

## Evolution across migrations

- **005 / 006**: identical 23-rule base set. Rule 20 (Civil Engineering) only
  matched `^পুরকৌশল (বিভাগ|বিভা)` — did not yet cover the `অনুষদ` (faculty)
  suffix variant.
- **007**: kept the same 23 base rules, widened rule 20 to also match
  `^পুরকৌশল (বিভাগ|বিভা|অনুষদ)`, and appended 4 new patterns (#24–#27) for
  abbreviation/mojibake forms the earlier passes missed (`সি.এস.ই`, `ত.ই. কৌশল`,
  `পি.এম.আর.ই`, `যন্ত্রকৌশল বিভাগ বাপ্রবি`).
- **010**: reuses the full 007 rule set unchanged, but only writes an update
  when a `presentees` row resolves to exactly **one** candidate department —
  ambiguous matches (multiple distinct departments for the same name) are
  left untouched rather than guessed.

## Where each rule set is applied

| Migration | Applied to | Match basis |
|---|---|---|
| 005 | `departments` rows with `serial > 22` (extras) → merged into canonical dept (`serial` 1–22), then extra row deleted | `name_bangla` of the extra department row |
| 006 | `members.department_id` (via `legacy_members.department`), then `presentees.department_id` (relational join, then `legacy_meeting.txtmembers` parse) | Legacy free-text department string |
| 007 | Same targets as 006 | Same, with the 4 extra patterns + widened Civil Engineering pattern |
| 010 | Remaining unresolved `presentees.department_id` | Same rule set, but only applied when exactly one candidate department is found (no designation match required) |
