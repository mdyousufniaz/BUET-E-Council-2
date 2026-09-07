-- Email drafts: one saved draft per (meeting, email type). A draft stores the
-- invitee subset selection plus everything not derivable from invitee ids
-- (from/subject/body/attach flag/extra attachments as base64 JSON).
CREATE TABLE IF NOT EXISTS email_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('notice', 'agenda', 'resolution')),
    invitee_ids UUID[] NOT NULL DEFAULT '{}',
    from_email TEXT,
    subject TEXT,
    body TEXT,
    attach_pdf BOOLEAN DEFAULT true,
    attachments JSONB NOT NULL DEFAULT '[]',
    created_by UUID REFERENCES users (id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (meeting_id, mode)
);
CREATE INDEX IF NOT EXISTS idx_email_drafts_meeting_id ON email_drafts (meeting_id);
