-- One-off cleanup: a race in ensureBibidhaAgenda() (GET /agendas ran the
-- "no bibidha row -> INSERT 'বিবিধ :'" check with no lock and no unique
-- constraint) let two concurrent requests insert the bibidha item twice,
-- so some meetings show "বিবিধ :" twice in the Agenda tab.
--
-- Keep the earliest-created bibidha row per meeting, drop the rest.
-- ensureBibidhaAgenda() re-serialises agenda_serial on the next load.

DELETE FROM agenda a
USING (
    SELECT id,
           row_number() OVER (PARTITION BY meeting_id ORDER BY created_at ASC, id ASC) AS rn
    FROM agenda
    WHERE is_suppli = false
      AND (is_archived = false OR is_archived IS NULL)
      AND regexp_replace(content, '<[^>]*>', '', 'g') ~ '^[[:space:]]*বিবিধ'
) d
WHERE a.id = d.id
  AND d.rn > 1;
