-- Migration: workflow-driven meeting status + resolution approval chain
-- Apply to an ALREADY-initialized database (init.sql only runs on a fresh volume).
-- Run AFTER 2026_07_file_initiator_workflow.sql. Safe to run more than once.
--
--   docker compose exec -T db psql -U admin -d ecouncil_db < db/migrations/2026_07_status_automation_and_resolution_chain.sql
--
-- NOTE: not wrapped in BEGIN/COMMIT — see the note in the earlier migration.

-- 1. The manual lock is gone. Marking a meeting completed is the lock now, so
--    both the is_locked flag and the unused 'locked' status value disappear.
ALTER TABLE meetings DROP COLUMN IF EXISTS is_locked;

-- Postgres cannot DROP a value from an enum, so rebuild the type. Any row still
-- sitting on the retired 'locked' value falls back to 'draft'.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'meeting_status' AND e.enumlabel = 'locked'
    ) THEN
        ALTER TABLE meetings ALTER COLUMN status DROP DEFAULT;
        ALTER TYPE meeting_status RENAME TO meeting_status_old;
        CREATE TYPE meeting_status AS ENUM ('draft', 'ongoing', 'past');
        ALTER TABLE meetings
            ALTER COLUMN status TYPE meeting_status
            USING (CASE WHEN status::text = 'locked' THEN 'draft' ELSE status::text END::meeting_status);
        ALTER TABLE meetings ALTER COLUMN status SET DEFAULT 'draft';
        DROP TYPE meeting_status_old;
    END IF;
END$$;

-- 2. Resolution approval chain: same shape as the agenda's workflow columns.
ALTER TABLE meetings
    ADD COLUMN IF NOT EXISTS resolution_stage meeting_stage NOT NULL DEFAULT 'initiator',
    ADD COLUMN IF NOT EXISTS resolution_return_source VARCHAR(20),
    ADD COLUMN IF NOT EXISTS resolution_moderator_note TEXT,
    ADD COLUMN IF NOT EXISTS resolution_admin_note TEXT;

-- 3. Carry the old single-flag approval over to the new chain, then retire it:
--    an already-approved resolution lands directly on the 'approved' stage.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'meetings' AND column_name = 'resolution_approved'
    ) THEN
        UPDATE meetings SET resolution_stage = 'approved' WHERE resolution_approved;
        ALTER TABLE meetings DROP COLUMN resolution_approved;
    END IF;
END$$;

-- 4. Backfill status so it agrees with the workflow it is now derived from:
--    an approved agenda means the meeting is ongoing. Completed ('past')
--    meetings are left exactly as they are.
UPDATE meetings SET status = 'ongoing'
 WHERE stage = 'approved' AND status = 'draft';
