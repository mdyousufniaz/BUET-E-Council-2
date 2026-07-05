-- Schema additions to make legacy ACQ concepts that have no current equivalent
-- (agenda categories/tags, agenda-department cross-refs) usable in the live app,
-- plus nullable legacy-id columns so the transform script can upsert idempotently
-- and stay traceable back to the source Oracle rows.

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    legacy_category_id NUMERIC UNIQUE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agenda_categories (
    agenda_id UUID REFERENCES agenda (id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories (id) ON DELETE CASCADE,
    PRIMARY KEY (agenda_id, category_id)
);

CREATE TABLE IF NOT EXISTS agenda_departments (
    agenda_id UUID REFERENCES agenda (id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments (id) ON DELETE CASCADE,
    PRIMARY KEY (agenda_id, department_id)
);

-- Meetings that historically spanned more than one sitting date; meetings.meeting_date
-- keeps the earliest date, the rest live here so nothing is lost.
CREATE TABLE IF NOT EXISTS meeting_extra_dates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    meeting_id UUID REFERENCES meetings (id) ON DELETE CASCADE,
    meeting_date TIMESTAMP WITH TIME ZONE NOT NULL
);

ALTER TABLE departments ADD COLUMN IF NOT EXISTS legacy_department_id NUMERIC UNIQUE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS legacy_member_id NUMERIC UNIQUE;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS legacy_meeting_no NUMERIC UNIQUE;
ALTER TABLE agenda ADD COLUMN IF NOT EXISTS legacy_agenda_id VARCHAR(20) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_username VARCHAR(100) UNIQUE;
