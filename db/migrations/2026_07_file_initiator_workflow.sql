-- Migration: File Initiator role + meeting approval workflow
-- Apply to an ALREADY-initialized database (init.sql only runs on a fresh volume).
-- Safe to run more than once.
--
--   docker compose exec -T db psql -U <user> -d <database> < db/migrations/2026_07_file_initiator_workflow.sql
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
-- PostgreSQL, so this script is intentionally not wrapped in BEGIN/COMMIT.

-- 1. New global roles (file_initiator from this feature; superadmin merged from main).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'file_initiator';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'superadmin';

-- 2. Approval-status enum (guarded so re-runs don't fail).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_approval_status') THEN
        CREATE TYPE meeting_approval_status AS ENUM ('draft', 'submitted', 'approved', 'sent_back');
    END IF;
END$$;

-- 3. Meeting ownership + workflow columns.
ALTER TABLE meetings
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approval_status meeting_approval_status NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS review_note TEXT,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE,
    -- is_approved backs the separate super_admin "dummy approve" merged from main.
    ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT FALSE;
