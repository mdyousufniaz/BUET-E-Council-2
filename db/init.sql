-- 1. Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "vector";

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. Define Enum Types
CREATE TYPE user_role AS ENUM ('admin', 'moderator', 'viewer', 'superadmin');

CREATE TYPE member_type_enum AS ENUM ('academic', 'syndicate', 'none');

CREATE TYPE meeting_type AS ENUM ('syndicate', 'academic');

CREATE TYPE meeting_status AS ENUM ('draft', 'ongoing', 'past', 'locked');

CREATE TYPE annexure_type AS ENUM ('agendaItem', 'resolution');

CREATE TYPE execution_bool AS ENUM ('yes', 'no');

CREATE TYPE member_status AS ENUM ('active', 'onleave', 'past');

CREATE TYPE template_visibility AS ENUM ('public', 'private');

CREATE TYPE template_type AS ENUM ('agendaItem', 'resolutionItem', 'agendam', 'resolution', 'description', 'conclusion');

CREATE TYPE content_type AS ENUM ('agendaItem', 'resolutionItem');

CREATE TYPE presentee_status AS ENUM ('yes', 'no');

CREATE TYPE account_status AS ENUM ('active', 'inactive');

-- 3. Create Tables

-- Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255) NOT NULL, -- Store hashed passwords only
    role user_role NOT NULL DEFAULT 'viewer',
    member_type member_type_enum NOT NULL DEFAULT 'none',
    status account_status NOT NULL DEFAULT 'active',
    legacy_username VARCHAR(100) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sessions Table
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    user_id UUID REFERENCES users (id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    device_info TEXT,
    ip_address VARCHAR(45),
    signin_location VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE faculties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    serial INTEGER,
    name_bangla VARCHAR(255) NOT NULL UNIQUE,
    name_english VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE offices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    serial INTEGER,
    name_bangla VARCHAR(255) NOT NULL UNIQUE,
    name_english VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    serial INTEGER,
    name_bangla VARCHAR(255) NOT NULL UNIQUE,
    name_english VARCHAR(255),
    alias_bangla VARCHAR(255),
    alias_english VARCHAR(255),
    faculty_id UUID REFERENCES faculties (id) ON DELETE SET NULL,
    legacy_department_id NUMERIC UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Members Table (Base table for people attending meetings)
CREATE TABLE members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    serial INTEGER,
    name VARCHAR(255) NOT NULL,
    prefix VARCHAR(255),
    designation VARCHAR(255),
    department_id UUID REFERENCES departments (id) ON DELETE SET NULL,
    office_id UUID REFERENCES offices (id) ON DELETE SET NULL,
    email VARCHAR(255) UNIQUE,
    member_type member_type_enum NOT NULL DEFAULT 'academic',
    legacy_member_id NUMERIC UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Meetings Table
CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    title VARCHAR(255) NOT NULL,
    meeting_title VARCHAR(255),
    description TEXT,
    president VARCHAR(255),
    conclusion TEXT,
    meeting_date TIMESTAMP WITH TIME ZONE NOT NULL,
    is_locked BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    type meeting_type NOT NULL,
    meeting_link VARCHAR(255),
    agenda_pdf_link VARCHAR(255),
    transcript VARCHAR(255),
    resolution_pdf_link VARCHAR(255),
    resolution_status_pdf_link VARCHAR(255),
    status meeting_status NOT NULL DEFAULT 'draft',
    legacy_meeting_no NUMERIC UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Content Table (Stores the core text data)
CREATE TABLE agenda (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    content TEXT,
    -- Plain-text mirror of `content` (HTML stripped), maintained by the app
    -- on every save. Backs full-text search (content_tsv) and is chunked for
    -- semantic embeddings (see agenda_chunks).
    content_plain TEXT,
    resolution TEXT,
    -- Plain-text mirror of `resolution`, same purpose as content_plain.
    resolution_plain TEXT,
    is_executed BOOLEAN DEFAULT false,
    execution_status TEXT, -- Detailed status description
    agenda_serial INTEGER, -- e.g., "Ag-1", "Res-5"
    meeting_id UUID REFERENCES meetings (id) ON DELETE CASCADE,
    legacy_agenda_id VARCHAR(20) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_suppli BOOLEAN DEFAULT false,
    -- Generated full-text search vectors. 'simple' config (no stemming) is
    -- used because it tokenizes Bangla and English equally well without an
    -- English-specific stemmer distorting Bangla tokens.
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content_plain, ''))) STORED,
    resolution_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(resolution_plain, ''))) STORED
);

-- Tags Table (user-facing agenda tagging)
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agenda_tags (
    agenda_id UUID REFERENCES agenda (id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (agenda_id, tag_id)
);

-- Chunked semantic-search embeddings (sentence-transformers/LaBSE, 768-dim).
-- Long agenda/resolution text is split into chunks so each embedding stays
-- within the model's effective input length.
CREATE TABLE agenda_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    agenda_id UUID REFERENCES agenda (id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding vector (768),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE resolution_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    agenda_id UUID REFERENCES agenda (id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding vector (768),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Search results cache, keyed by a hash of the query + filters. Wiped
-- whenever agenda/resolution content is re-indexed so results never go
-- stale; created_at also lets old unused entries be swept periodically.
CREATE TABLE search_cache (
    cache_key VARCHAR(64) PRIMARY KEY,
    query TEXT NOT NULL,
    filters JSONB,
    results JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Templates Table
CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    text_content TEXT NOT NULL,
    visibility template_visibility NOT NULL DEFAULT 'private',
    created_by UUID REFERENCES users (id) ON DELETE SET NULL,
    type template_type NOT NULL,
    used_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invitees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    designation VARCHAR(255),
    department_id UUID REFERENCES departments (id) ON DELETE SET NULL,
    office_id UUID REFERENCES offices (id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    meeting_id UUID REFERENCES meetings (id) ON DELETE CASCADE,
    is_present BOOLEAN DEFAULT false,
    -- Seniority order among invitees. Mirrors the linked member's serial (see
    -- sync_invitee_serial trigger below) so reordering a member automatically
    -- reorders their still-pending invitee rows.
    serial INTEGER,
    -- The member this invitee was created from, if any. NULL for custom
    -- (non-member) invitees, which never get their serial auto-synced.
    member_id UUID REFERENCES members (id) ON DELETE SET NULL
);

-- Presentees Table (Linking table for attendance)
CREATE TABLE presentees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name VARCHAR(255),
    designation VARCHAR(255),
    department_id UUID REFERENCES departments (id) ON DELETE SET NULL,
    office_id UUID REFERENCES offices (id) ON DELETE SET NULL,
    meeting_id UUID REFERENCES meetings (id) ON DELETE CASCADE,
    -- Seniority order captured at the time attendance was finalized (from the
    -- source invitee/member's serial at that moment). Frozen from then on —
    -- unlike invitees, presentees are never resynced to later member changes.
    serial INTEGER
);

-- Keeps a pending invitee's serial in lockstep with the seniority-order
-- serial of the member it was created from, so reordering members (add-time
-- shift or drag-and-drop reorder) is reflected without touching invitees
-- directly. Presentees are intentionally excluded — their serial is frozen
-- once a meeting completes.
CREATE OR REPLACE FUNCTION sync_invitee_serial () RETURNS TRIGGER AS $$
BEGIN
    UPDATE invitees SET serial = NEW.serial WHERE member_id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_invitee_serial
AFTER UPDATE OF serial ON members FOR EACH ROW
WHEN (OLD.serial IS DISTINCT FROM NEW.serial)
EXECUTE FUNCTION sync_invitee_serial ();

-- Revisions Table (Version control for content)
CREATE TABLE revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    text_content TEXT NOT NULL,
    content_id UUID REFERENCES agenda (id) ON DELETE CASCADE,
    content_type content_type,
    modified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    modified_by UUID REFERENCES users (id) ON DELETE SET NULL
);

-- Annexures Table (Attachments/Appendices)
CREATE TABLE annexures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    content_id UUID REFERENCES agenda (id) ON DELETE CASCADE,
    annexure_type annexure_type,
    file_name VARCHAR(255),
    file_path VARCHAR(255),
    summary TEXT,
    annexure_serial INTEGER DEFAULT 1,
    upload_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Audit Log Table ("who did what"). user_id is kept nullable and username is
-- denormalized so a log entry still reads meaningfully after its user is
-- deleted. Written by both auth_service (login/logout/user management) and
-- meeting_service (everything else), which share this database.
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    username VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Search indexes
-- None of these foreign-key columns get an automatic index in Postgres, and
-- all of them are hit by the search/history queries below.
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX idx_agenda_meeting_id ON agenda (meeting_id);
-- Hit by sync_invitee_serial() on every member serial change.
CREATE INDEX idx_invitees_member_id ON invitees (member_id);
CREATE INDEX idx_agenda_tags_tag_id ON agenda_tags (tag_id);
CREATE INDEX idx_agenda_chunks_agenda_id ON agenda_chunks (agenda_id);
CREATE INDEX idx_resolution_chunks_agenda_id ON resolution_chunks (agenda_id);
CREATE INDEX idx_revisions_content_id ON revisions (content_id);

-- Full-text search over agenda/resolution plain-text mirrors.
CREATE INDEX idx_agenda_content_tsv ON agenda USING GIN (content_tsv);
CREATE INDEX idx_agenda_resolution_tsv ON agenda USING GIN (resolution_tsv);

-- Trigram indexes for fuzzy/substring entity matching (department, office,
-- member search). Kept live against these tables directly, so entity
-- matching is always current with no separate sync step.
CREATE INDEX idx_departments_trgm ON departments USING GIN (
    (
        name_bangla || ' ' || coalesce(name_english, '') || ' ' || coalesce(alias_bangla, '') || ' ' || coalesce(alias_english, '')
    ) gin_trgm_ops
);
CREATE INDEX idx_offices_trgm ON offices USING GIN (
    (name_bangla || ' ' || coalesce(name_english, '')) gin_trgm_ops
);
CREATE INDEX idx_members_name_trgm ON members USING GIN (name gin_trgm_ops);
CREATE INDEX idx_faculties_trgm ON faculties USING GIN (
    (name_bangla || ' ' || coalesce(name_english, '')) gin_trgm_ops
);
CREATE INDEX idx_presentees_name_trgm ON presentees USING GIN (name gin_trgm_ops);

INSERT INTO
    users (
        username,
        email,
        password,
        role,
        status
    )
VALUES (
        'admin',
        'admin@buet.ac.bd',
        '$2b$10$Uept771hLFh/Wc0hKa8wZeS9XLVfvXdNYpVUq2oGhq/Fk3K4wvQaq', -- bcrypt hash of '123456' (matches README's documented default)
        'admin',
        'active'
    )
ON CONFLICT DO NOTHING;

INSERT INTO
    users (
        username,
        email,
        password,
        role,
        status
    )
VALUES (
        'superadmin',
        'superadmin@buet.ac.bd',
        '$2b$10$Uept771hLFh/Wc0hKa8wZeS9XLVfvXdNYpVUq2oGhq/Fk3K4wvQaq', -- bcrypt hash of '123456' (same hash reused, same password)
        'superadmin',
        'active'
    )
ON CONFLICT DO NOTHING;

INSERT INTO
    faculties (name_english, name_bangla)
VALUES (
        'Faculty of Architecture and Planning',
        'স্থাপত্য ও পরিকল্পনা অনুষদ'
    ),
    (
        'Faculty of Civil Engineering',
        'পুরকৌশল অনুষদ'
    ),
    (
        'Faculty of Electrical and Electronic Engineering',
        'তড়িৎ ও ইলেক্ট্রনিক কৌশল অনুষদ'
    ),
    (
        'Faculty of Mechanical Engineering',
        'যন্ত্রকৌশল অনুষদ'
    ),
    (
        'Faculty of Chemical and Materials Engineering',
        'কেমিক্যাল ও ম্যাটেরিয়ালস কৌশল অনুষদ'
    ),
    (
        'Faculty of Science',
        'বিজ্ঞান অনুষদ'
    ),
    (
        'Faculty of Post Graduate Studies',
        'স্নাতকোত্তর স্টাডিজ অনুষদ'
    );

INSERT INTO
    departments (
        serial,
        name_bangla,
        name_english,
        alias_bangla,
        alias_english,
        faculty_id
    )
VALUES (
        1,
        'পানি সম্পদ কৌশল বিভাগ',
        'Water Resources Engineering',
        'ডব্লিউআরই',
        'WRE',
        NULL
    ),
    (
        2,
        'নগর ও অঞ্চল পরিকল্পনা বিভাগ',
        'Urban and Regional Planning',
        'ইউআরপি',
        'URP',
        NULL
    ),
    (
        3,
        'পেট্রোলিয়াম ও মিনারেল রিসোর্সেস প্রকৌশল বিভাগ',
        'Petroleum and Mineral Resources Engineering',
        'পিএমআরই',
        'PMRE',
        NULL
    ),
    (
        4,
        'পদার্থবিজ্ঞান বিভাগ',
        'Physics',
        'ফিজিক্স',
        'Phy',
        NULL
    ),
    (
        5,
        'ন্যানোম্যাটেরিয়ালস এন্ড সিরামিক ইঞ্জিনিয়ারিং বিভাগ',
        'Nanomaterials and Ceramic Engineering',
        'এনসিই',
        'NCE',
        NULL
    ),
    (
        6,
        'নৌযান ও নৌযন্ত্র কৌশল বিভাগ',
        'Naval Architecture and Marine Engineering',
        'এনএএমই',
        'NAME',
        NULL
    ),
    (
        7,
        'বস্তু ও ধাতব কৌশল বিভাগ',
        'Materials and Metallurgical Engineering',
        'এমএমই',
        'MME',
        NULL
    ),
    (
        8,
        'যন্ত্রকৌশল বিভাগ',
        'Mechanical Engineering',
        'এমই',
        'ME',
        NULL
    ),
    (
        9,
        'গণিত বিভাগ',
        'Mathematics',
        'ম্যাথ',
        'Math',
        NULL
    ),
    (
        10,
        'পানি ও বন্যা ব্যবস্থাপনা ইনস্টিটিউট',
        'Institute of Water and Flood Management',
        'আইডব্লিউএফএম',
        'IWFM',
        NULL
    ),
    (
        11,
        'শিল্প ও উৎপাদন কৌশল বিভাগ',
        'Industrial and Production Engineering',
        'আইপিই',
        'IPE',
        NULL
    ),
    (
        12,
        'তথ্য ও যোগাযোগ প্রযুক্তি ইনস্টিটিউট',
        'Institute of Information and Communication Technology',
        'আইআইসিটি',
        'IICT',
        NULL
    ),
    (
        13,
        'লাগসই প্রযুক্তি ইনস্টিটিউট',
        'Institute of Appropriate Technology',
        'আইএটি',
        'IAT',
        NULL
    ),
    (
        14,
        'মানবিক বিভাগ',
        'Humanities',
        'হিউম',
        'Hum',
        NULL
    ),
    (
        15,
        'তড়িৎ ও ইলেক্ট্রনিক কৌশল বিভাগ',
        'Electrical and Electronic Engineering',
        'ইইই',
        'EEE',
        NULL
    ),
    (
        16,
        'কম্পিউটার সায়েন্স এন্ড ইঞ্জিনিয়ারিং বিভাগ',
        'Computer Science and Engineering',
        'সিএসই',
        'CSE',
        NULL
    ),
    (
        17,
        'রসায়ন বিভাগ',
        'Chemistry',
        'কেম',
        'Chem',
        NULL
    ),
    (
        18,
        'কেমিকৌশল বিভাগ',
        'Chemical Engineering',
        'সিএইচই',
        'ChE',
        NULL
    ),
    (
        19,
        'পুরকৌশল বিভাগ',
        'Civil Engineering',
        'সিই',
        'CE',
        NULL
    ),
    (
        20,
        'বায়োমেডিকেল ইঞ্জিনিয়ারিং বিভাগ',
        'Biomedical Engineering',
        'বিএমই',
        'BME',
        NULL
    ),
    (
        21,
        'দুর্ঘটনা গবেষণা ইনস্টিটিউট',
        'Accident Research Institute',
        'এআরআই',
        'ARI',
        NULL
    ),
    (
        22,
        'স্থাপত্য বিভাগ',
        'Architecture',
        'আর্চ',
        'Arch',
        NULL
    );

INSERT INTO
    offices (
        serial,
        name_bangla,
        name_english
    )
VALUES (
        1,
        'বিভাগীয় প্রধান, পেট্রোলিয়াম ও মিনারেল রিসোর্সেস প্রকৌশল বিভাগ (পিএমআরই)',
        'Department Head, Department of Petroleum & Mineral Resources Engineering (PMRE)'
    ),
    (
        2,
        'ডিন, স্থাপত্য ও পরিকল্পনা অনুষদ',
        'Dean, Faculty of Architecture and Planning'
    ),
    (
        3,
        'বিভাগীয় প্রধান, বস্তু ও ধাতব কৌশল বিভাগ (এমএমই)',
        'Department Head, Department of Materials & Metallurgical Engineering (MME)'
    ),
    (
        4,
        'ডিন, যন্ত্রকৌশল অনুষদ',
        'Dean, Faculty of Mechanical Engineering'
    ),
    (
        5,
        'বিভাগীয় প্রধান, স্থাপত্য বিভাগ (আর্চ)',
        'Department Head, Department of Architecture (ARCH)'
    ),
    (
        6,
        'বিভাগীয় প্রধান, রসায়ন বিভাগ (কেম)',
        'Department Head, Department of Chemistry (CHEM)'
    ),
    (
        7,
        'ডিন, কেমিক্যাল ও ম্যাটেরিয়ালস কৌশল অনুষদ (এফসিএমই)',
        'Dean, Faculty of Chemical & Materials Engineering (FCME)'
    ),
    (
        8,
        'ডিন, পুরকৌশল অনুষদ',
        'Dean, Faculty of Civil Engineering'
    ),
    (
        9,
        'বিভাগীয় প্রধান, কম্পিউটার সায়েন্স এন্ড ইঞ্জিনিয়ারিং বিভাগ (সিএসই)',
        'Department Head, Department of Computer Science & Engineering (CSE)'
    ),
    (
        10,
        'বিভাগীয় প্রধান, কেমিকৌশল বিভাগ (সিএইচই)',
        'Department Head, Department of Chemical Engineering (ChE)'
    ),
    (
        11,
        'বিভাগীয় প্রধান, গণিত বিভাগ (ম্যাথ)',
        'Department Head, Department of Mathematics (MATH)'
    ),
    (
        12,
        'বিভাগীয় প্রধান, পানি সম্পদ কৌশল বিভাগ (ডব্লিউআরই)',
        'Department Head, Department of Water Resources Engineering (WRE)'
    ),
    (
        13,
        'ডিন, তড়িৎ ও ইলেক্ট্রনিক কৌশল অনুষদ',
        'Dean, Faculty of Electrical & Electronic Engineering'
    ),
    (
        14,
        'বিভাগীয় প্রধান, ন্যানোম্যাটেরিয়ালস এন্ড সিরামিক ইঞ্জিনিয়ারিং বিভাগ (এনসিই)',
        'Department Head, Department of Nanomaterials & Ceramics Engineering (NCE)'
    ),
    (
        15,
        'বিভাগীয় প্রধান, শিল্প ও উৎপাদন কৌশল বিভাগ (আইপিই)',
        'Department Head, Department of Industrial & Production Engineering (IPE)'
    ),
    (
        16,
        'বিভাগীয় প্রধান, পুরকৌশল বিভাগ (সিই)',
        'Department Head, Department of Civil Engineering (CE)'
    ),
    (
        17,
        'বিভাগীয় প্রধান, বায়োমেডিকেল ইঞ্জিনিয়ারিং বিভাগ (বিএমই)',
        'Department Head, Department of Bio-Medical Engineering (BME)'
    ),
    (
        18,
        'বিভাগীয় প্রধান, পদার্থবিজ্ঞান বিভাগ (ফিজিক্স)',
        'Department Head, Department of Physics (Phy)'
    ),
    (
        19,
        'বিভাগীয় প্রধান, মানবিক বিভাগ (হিউম)',
        'Department Head, Department of Humanities (HUM)'
    ),
    (
        20,
        'বিভাগীয় প্রধান, যন্ত্রকৌশল বিভাগ (এমই)',
        'Department Head, Department of Mechanical Engineering (ME)'
    ),
    (
        21,
        'ডিন, বিজ্ঞান অনুষদ',
        'Dean, Faculty of Science'
    ),
    (
        22,
        'বিভাগীয় প্রধান, নৌযান ও নৌযন্ত্র কৌশল বিভাগ (এনএএমই)',
        'Department Head, Department of Naval Arch. & Marine Engineering (NAME)'
    ),
    (
        23,
        'বিভাগীয় প্রধান, নগর ও অঞ্চল পরিকল্পনা বিভাগ (ইউআরপি)',
        'Department Head, Department of Urban & Regional Planning (URP)'
    ),
    (
        24,
        'ডিন, স্নাতকোত্তর স্টাডিজ অনুষদ',
        'Dean, Faculty of Post Graduate Studies'
    ),
    (
        25,
        'বিভাগীয় প্রধান, তড়িৎ ও ইলেক্ট্রনিক কৌশল বিভাগ (ইইই)',
        'Department Head, Department of Electrical & Electronic Engineering (EEE)'
    ),
    (
        26,
        'উপাচার্য, বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়',
        'Vice Chancellor, Bangladesh University of Engineering and Technology'
    ),
    (
        27,
        'উপ-উপাচার্য, বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়',
        'Pro-Vice Chancellor, Bangladesh University of Engineering and Technology'
    );