-- 1. Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "vector";

-- 2. Define Enum Types
CREATE TYPE user_role AS ENUM ('admin', 'moderator', 'member');

CREATE TYPE member_type_enum AS ENUM ('academic', 'syndicate', 'none');

CREATE TYPE meeting_type AS ENUM ('syndicate', 'academic');

CREATE TYPE meeting_status AS ENUM ('draft', 'ongoing', 'past', 'locked');

CREATE TYPE annexure_type AS ENUM ('agendaItem', 'resolution');

CREATE TYPE execution_bool AS ENUM ('yes', 'no');

CREATE TYPE member_status AS ENUM ('active', 'onleave', 'past');

CREATE TYPE template_visibility AS ENUM ('public', 'private');

CREATE TYPE template_type AS ENUM ('agendaItem', 'resolutionItem');

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
    role user_role NOT NULL DEFAULT 'member',
    member_type member_type_enum NOT NULL DEFAULT 'none',
    status account_status NOT NULL DEFAULT 'active',
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
    name_english VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE offices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    serial INTEGER,
    name_bangla VARCHAR(255) NOT NULL UNIQUE,
    name_english VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    serial INTEGER,
    name_bangla VARCHAR(255) NOT NULL UNIQUE,
    name_english VARCHAR(255) NOT NULL UNIQUE,
    alias_bangla VARCHAR(255) NOT NULL UNIQUE,
    alias_english VARCHAR(255) NOT NULL UNIQUE,
    faculty_id UUID NOT NULL REFERENCES faculties (id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Members Table (Base table for people attending meetings)
CREATE TABLE members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name VARCHAR(255) NOT NULL,
    prefix VARCHAR(255),
    designation VARCHAR(255),
    department_id UUID REFERENCES departments (id) ON DELETE SET NULL,
    office_id UUID REFERENCES offices (id) ON DELETE SET NULL,
    email VARCHAR(255) UNIQUE,
    member_type member_type_enum NOT NULL DEFAULT 'none',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Meetings Table
CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    title VARCHAR(255) NOT NULL,
    meeting_date TIMESTAMP WITH TIME ZONE NOT NULL,
    type meeting_type NOT NULL,
    meeting_link VARCHAR(255),
    agenda_pdf_link VARCHAR(255),
    transcript VARCHAR(255),
    resolution_pdf_link VARCHAR(255),
    status meeting_status NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Content Table (Stores the core text data and embeddings)
CREATE TABLE agenda (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    -- 'vector(1536)' is standard for OpenAI embeddings. 
    -- Change 1536 to your specific model's dimension if different.
    content TEXT,
    embedding vector (1536),
    resolution TEXT,
    resolution_embedding vector (1536),
    is_executed execution_bool DEFAULT 'no',
    execution_status TEXT, -- Detailed status description
    agenda_serial INTEGER, -- e.g., "Ag-1", "Res-5"
    meeting_id UUID REFERENCES meetings (id) ON DELETE CASCADE,
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
    email VARCHAR(255) UNIQUE,
    designation VARCHAR(255),
    department_id UUID REFERENCES departments (id) ON DELETE SET NULL,
    office_id UUID REFERENCES offices (id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    meeting_id UUID REFERENCES meetings (id) ON DELETE CASCADE,
    is_present BOOLEAN DEFAULT false
);

-- Presentees Table (Linking table for attendance)
CREATE TABLE presentees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name VARCHAR(255) NOT NULL,
    designation VARCHAR(255),
    department_id UUID REFERENCES departments (id) ON DELETE SET NULL,
    office_id UUID REFERENCES offices (id) ON DELETE SET NULL,
    meeting_id UUID REFERENCES meetings (id) ON DELETE CASCADE
);

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
    embedding vector (1536), -- Vector embedding for the annexure summary/content
    upload_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

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
        '$2b$10$BaqfwMRoqUJ2hAAd8Y4jvenpMOIl2n4R65VVz2yzaIDG.01pFnU/y',
        'admin',
        'active'
    )
ON CONFLICT DO NOTHING;