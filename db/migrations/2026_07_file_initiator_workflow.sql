-- Migration: File Initiator role + meeting approval escalation workflow
-- Apply to an ALREADY-initialized database (init.sql only runs on a fresh volume).
-- Safe to run more than once.
--
--   docker compose exec -T db psql -U admin -d ecouncil_db < db/migrations/2026_07_file_initiator_workflow.sql
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
-- PostgreSQL, so this script is intentionally not wrapped in BEGIN/COMMIT.

-- 1. Roles (file_initiator from this feature; superadmin merged from main).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'file_initiator';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'superadmin';

-- 2. Escalation-stage enum (guarded so re-runs don't fail).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_stage') THEN
        CREATE TYPE meeting_stage AS ENUM ('initiator', 'moderator', 'admin', 'approved');
    END IF;
END$$;

-- 3. Meeting ownership + workflow columns.
ALTER TABLE meetings
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS stage meeting_stage NOT NULL DEFAULT 'initiator',
    ADD COLUMN IF NOT EXISTS moderator_can_return BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS resolution_approved BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS review_note TEXT,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE;

-- 4. Drop the superseded columns from earlier iterations, if present.
--    (approval_status: replaced by stage; is_approved: the removed dummy approve.)
ALTER TABLE meetings DROP COLUMN IF EXISTS approval_status;
ALTER TABLE meetings DROP COLUMN IF EXISTS is_approved;
DROP TYPE IF EXISTS meeting_approval_status;
