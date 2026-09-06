-- Explicit single-select resolution status on agenda.
-- Root cause of the "edited Not Executed shows as Custom" bug: Not Executed
-- and Custom shared identical storage (is_executed=false, text,
-- is_submitted_for_next_meeting=false), so the selected radio could only be
-- *derived* from flags+text — any edited Not-Executed text (anything other
-- than the exact default) was indistinguishable from Custom. This column is
-- now the source of truth, written on every status change.
ALTER TABLE agenda
    ADD COLUMN IF NOT EXISTS resolution_status VARCHAR(20);

-- Backfill pre-migration rows only (NULLs). Explicit saves are never NULL,
-- so re-running this can never clobber an explicit selection.
UPDATE agenda SET resolution_status = 'submitted'
WHERE resolution_status IS NULL AND is_submitted_for_next_meeting IS TRUE;

UPDATE agenda SET resolution_status = 'executed'
WHERE resolution_status IS NULL
  AND is_submitted_for_next_meeting IS NOT TRUE
  AND is_executed IS TRUE;

UPDATE agenda SET resolution_status = 'custom'
WHERE resolution_status IS NULL
  AND is_submitted_for_next_meeting IS NOT TRUE
  AND is_executed IS NOT TRUE
  AND execution_status IS NOT NULL
  AND btrim(regexp_replace(execution_status, '<[^>]*>', '', 'g')) <> ''
  AND btrim(regexp_replace(execution_status, '<[^>]*>', '', 'g')) NOT IN ('অবাস্তবায়িত', 'অবাস্তবায়িত');

UPDATE agenda SET resolution_status = 'not_executed'
WHERE resolution_status IS NULL;

ALTER TABLE agenda ALTER COLUMN resolution_status SET DEFAULT 'not_executed';
