# BUET E-Council — Developer Guide & Technical Documentation

This document serves as the comprehensive technical specification and developer guide for the **BUET E-Council Meeting Management System**. It covers architectural patterns, core algorithms, database schemas, workflow permission engines, search indexers, PDF generation mechanics, and API references.

---

## Table of Contents

- [1. System Architecture & Topology](#1-system-architecture--topology)
  - [1.1 Service Decomposition](#11-service-decomposition)
  - [1.2 Communication Protocols & Network Security](#12-communication-protocols--network-security)
- [2. Database Schema & Data Modeling](#2-database-schema--data-modeling)
  - [2.1 Extensions & Enum Types](#21-extensions--enum-types)
  - [2.2 Core Tables & Entity Relationships](#22-core-tables--entity-relationships)
  - [2.3 Full-Text & Vector Indexes](#23-full-text--vector-indexes)
  - [2.4 Database Triggers & Automated Functions](#24-database-triggers--automated-functions)
- [3. Deep Dive: Core Engineering Subsystems](#3-deep-dive-core-engineering-subsystems)
  - [3.1 Level-Based Handover & Locking Engine](#31-level-based-handover--locking-engine)
    - [3.1.1 Lock Types & Access Control Matrix](#311-lock-types--access-control-matrix)
    - [3.1.2 Handover Lifecycle & State Transitions](#312-handover-lifecycle--state-transitions)
    - [3.1.3 Send-Back (Reject & Return) Feature](#313-send-back-reject--return-feature)
    - [3.1.4 Middleware & Client Implementation](#314-middleware--client-implementation)
  - [3.2 3-Tier Hybrid Search Engine](#32-3-tier-hybrid-search-engine)
    - [3.2.1 Query Parsing & SHA-256 Caching](#321-query-parsing--sha-256-caching)
    - [3.2.2 Tier 0: Keyword Search Engine (Postgres `tsvector` & `'simple'` Dictionary)](#322-tier-0-keyword-search-engine-postgres-tsvector--simple-dictionary)
    - [3.2.3 Tier 1: Entity Search Engine (`gin_trgm_ops` Fuzzy Matching)](#323-tier-1-entity-search-engine-gin_trgm_ops-fuzzy-matching)
    - [3.2.4 Tier 2: Vector Semantic Search Engine (`pgvector` HNSW + `bge-m3`)](#324-tier-2-vector-semantic-search-engine-pgvector-hnsw--bge-m3)
    - [3.2.5 Trigger-Based Cache Invalidation](#325-trigger-based-cache-invalidation)
  - [3.3 Asynchronous Vector Embedding Pipeline](#33-asynchronous-vector-embedding-pipeline)
  - [3.4 PDF Generation & Typography Engine](#34-pdf-generation--typography-engine)
  - [3.5 MinIO S3 Object Storage & Media Proxy](#35-minio-s3-object-storage--media-proxy)
  - [3.6 JSON Import & Regex Entity Resolution Engine](#36-json-import--regex-entity-resolution-engine)
  - [3.7 Audit Logging & Session Management](#37-audit-logging--session-management)
- [4. API Endpoint Reference](#4-api-endpoint-reference)
  - [4.1 Authentication Service (`/api/auth`)](#41-authentication-service-apiauth)
  - [4.2 Meeting Service (`/api/meetings`, `/api/agendas`, etc.)](#42-meeting-service-apimeetings-apiagendas-etc)
  - [4.3 Search API (`/api/search`)](#43-search-api-apisearch)
  - [4.4 Storage API (`/storage`)](#44-storage-api-storage)
  - [4.5 Embedding Service API (`http://embedding_service:8002`)](#45-embedding-service-api-httpembeddingservice8002)
- [5. Frontend Architecture & Design System](#5-frontend-architecture--design-system)
  - [5.1 Email Tab — Meeting Notification & Document System](#51-email-tab--meeting-notification--document-system)
  - [5.2 Notice PDF Generation — On-the-Fly Document Engine](#52-notice-pdf-generation--on-the-fly-document-engine)
  - [5.3 Attendance Sheet — Section-Separated PDF Generation](#53-attendance-sheet--section-separated-pdf-generation)
  - [5.4 Take Attendance — Search & Filter](#54-take-attendance--search--filter)
  - [5.5 Resolution PDF — Dynamic Column Layout](#55-resolution-pdf--dynamic-column-layout)
  - [5.6 Signed Persona — Resolution Signature Configuration](#56-signed-persona--resolution-signature-configuration)
  - [5.7 Resolution Status — Single-Select UI](#57-resolution-status--single-select-ui)
  - [5.8 Rich Text Editor — Word-Style Ribbon & Multi-Theme System](#58-rich-text-editor--word-style-ribbon--multi-theme-system)
  - [5.9 PDF Preview — Interactive Layout & Inline Editing](#59-pdf-preview--interactive-layout--inline-editing)
  - [5.10 Archived Agenda — Snapshot View](#510-archived-agenda--snapshot-view)
- [6. Development, Maintenance & Troubleshooting](#6-development-maintenance--troubleshooting)
  - [6.1 Running via Docker Compose](#61-running-via-docker-compose)
  - [6.2 Local Microservice Development Setup](#62-local-microservice-development-setup)
  - [6.3 Troubleshooting Guide](#63-troubleshooting-guide)

---

## 1. System Architecture & Topology

### 1.1 Service Decomposition

BUET E-Council is structured as a decoupled microservices architecture. Each container encapsulates a dedicated responsibility:

```
[ NGINX Gateway :9001 ]
       |
       +---> [ frontend:3000 ]         (Next.js App Router UI)
       +---> [ auth_service:8000 ]     (Express Auth & RBAC API)
       +---> [ meeting_service:8001 ]  (Express Core Business API & PDF Generator)
       |         |
       |         +--> [ BullMQ Queue ] ---> [ embedding_worker ] ---> [ embedding_service:8002 ]
       |                   |                       |                       (Python FastAPI BGE-M3)
       |                   v                       v
       +---> [ minio:9000 ] <----+                 +---> [ PostgreSQL 16 + pgvector ]
             (S3 Storage)        | (SigV4 Presigned)
```

### 1.2 Communication Protocols & Network Security

1. **Gateway Isolation**: Direct external access is limited exclusively to NGINX on host port `9001`. Internal microservices (`auth_service`, `meeting_service`, `embedding_service`, `redis`, `minio`, `db`) communicate across an isolated Docker internal bridge network.
2. **Dynamic Upstream DNS Resolution**: NGINX uses Docker's embedded DNS server (`127.0.0.11 valid=10s`) combined with `set $upstream` variables to force IP re-resolution on request, avoiding dead IP locks when containers restart.
3. **Session Propagation**: Authenticated API calls transport standard HTTP `Authorization: Bearer <session_token>` headers or `session_token` HttpOnly cookies.

---

## 2. Database Schema & Data Modeling

### 2.1 Extensions & Enum Types

The database is built on PostgreSQL 16 with three core extensions enabled in [`db/init.sql`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/db/init.sql):
- **`uuid-ossp`**: Native UUID generation (`uuid_generate_v4()`).
- **`vector`**: Vector field support (`vector(1024)`) and HNSW cosine distance indexing (`vector_cosine_ops`).
- **`pg_trgm`**: Trigram index support (`gin_trgm_ops`) for fast fuzzy text matching.

#### Domain Enums

```sql
CREATE TYPE user_role AS ENUM ('admin', 'viewer', 'editor', 'superadmin', 'moderator', 'file_initiator');
CREATE TYPE member_type_enum AS ENUM ('academic', 'syndicate', 'none');
CREATE TYPE meeting_type AS ENUM ('syndicate', 'academic');
CREATE TYPE annexure_type AS ENUM ('agendaItem', 'resolution');
CREATE TYPE template_type AS ENUM ('agendaItem', 'resolutionItem', 'agendam', 'resolution', 'description', 'conclusion');
CREATE TYPE account_status AS ENUM ('active', 'inactive');
```

---

### 2.2 Core Tables & Entity Relationships

```
  +------------------+         +------------------+         +------------------+
  |      roles       |         |      users       |         |     sessions     |
  +------------------+         +------------------+         +------------------+
  | id (PK)          |<--------| role_id (FK)     |         | id (PK)          |
  | level (INT, UNQ) |         | id (PK)          |<--------| user_id (FK)     |
  | level_title      |         | username, email  |         | session_token    |
  +------------------+         +------------------+         +------------------+
                                        ^
                                        | (created_by)
                               +------------------+
                               |     meetings     |
                               +------------------+
                               | id (PK)          |
                               | title, date, type|
                               | agenda_handover  |
                               | agenda_locked    |
                               | resolution_hand  |
                               | is_completed     |
                               +------------------+
                                        |
                                        v (CASCADE)
                               +------------------+
                               |      agenda      |
                               +------------------+
                               | id (PK)          |
                               | meeting_id (FK)  |
                               | content, plain   |
                               | resolution, plain|
                               | is_executed      |
                               | execution_status |
                               | is_archived      |
                               | is_submitted_for_next_meeting |
                               | content_tsv      |
                               | resolution_tsv   |
                               +------------------+
                                 /              \
                                /                \
                               v                  v
                    +------------------+  +-------------------+
                    |  agenda_chunks   |  | resolution_chunks |
                    +------------------+  +-------------------+
                    | id (PK)          |  | id (PK)           |
                    | agenda_id (FK)   |  | agenda_id (FK)    |
                    | embedding (1024) |  | embedding (1024)  |
                    +------------------+  +-------------------+
```

#### Field Descriptions: Key Entities

1. **`roles`**: Defines numerical hierarchy levels (`level` column). Lower integer numbers denote lower organizational hierarchy; higher integer numbers denote administrative/review levels (e.g., Level 3 > Level 2 > Level 1).
2. **`meetings`**: Stores meeting metadata along with workflow level tracking columns:
   - Handover fields: `agenda_handover_level`, `suppli_agenda_handover_level`, `resolution_handover_level`, `resolution_status_handover_level`
   - Lock fields: `agenda_locked_level`, `suppli_agenda_locked_level`, `resolution_locked_level`, `resolution_status_locked_level`, `meeting_locked_level`, `invitees_locked_level`, `presentees_locked_level`, `conclusion_locked_level`
   - Signature fields: `president_signature` (TEXT), `secretary_signature` (TEXT) — per-meeting signature overrides for resolution PDFs
3. **`agenda`**: Agenda and resolution content. Automatically maintains generated `content_tsv` and `resolution_tsv` tsvector columns using PostgreSQL's `simple` text search dictionary. Resolution status is stored per agendum via `resolution_status` (`not_executed` | `executed` | `submitted` | `custom`, the single-select source of truth), `execution_status` (display text for the selected status, rendered as-is in the resolution-status PDF), and `is_submitted_for_next_meeting` (archive flag for Submit for Next Meeting).
4. **`agenda_chunks` & `resolution_chunks`**: Stores text chunks and their 1024-dimensional float vector embeddings output by `BAAI/bge-m3`.
5. **`invitees`**: Unified entity managing both meeting invitees and attendance presentee records (`is_present BOOLEAN DEFAULT false`). Automatically mirrors seniority serial from linked `members` (`member_id`) via database trigger `trg_sync_invitee_serial`. Note that the legacy `presentees` table has been removed.

6. **`notices`**: Stores notice metadata for generated PDFs. Used for notice number tracking and history (not currently persisted — PDFs are generated on-the-fly from form data).

7. **`system_settings`**: Key-value store for system-wide configuration. Stores signature text for academic and syndicate notices, plus signed persona defaults for resolution PDFs:
   ```sql
   CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );
   -- Notice signature keys: 'academic_signature_str', 'syndicate_signature_str'
   -- Signed persona keys: 'academic_president_signature', 'academic_secretary_signature',
   --                       'syndicate_president_signature', 'syndicate_secretary_signature'
   ```

---

### 2.3 Full-Text & Vector Indexes

```sql
-- HNSW Vector Indexes for Fast Cosine Distance Search
CREATE INDEX idx_agenda_chunks_hnsw 
ON agenda_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_resolution_chunks_hnsw 
ON resolution_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Full-Text GIN Indexes
CREATE INDEX idx_agenda_content_tsv ON agenda USING GIN (content_tsv);
CREATE INDEX idx_agenda_resolution_tsv ON agenda USING GIN (resolution_tsv);

-- Trigram Fuzzy Indexes
CREATE INDEX idx_departments_trgm ON departments USING GIN (
    (name_bangla || ' ' || coalesce(name_english, '') || ' ' || coalesce(alias_bangla, '') || ' ' || coalesce(alias_english, '')) gin_trgm_ops
);
CREATE INDEX idx_members_name_trgm ON members USING GIN (name gin_trgm_ops);
```

---

### 2.4 Database Triggers & Automated Functions

1. **`sync_invitee_serial()` Trigger**: Synchronizes an invitee's `serial` field automatically when the corresponding member's global seniority `serial` changes in the `members` table:
   ```sql
   CREATE TRIGGER trg_sync_invitee_serial
   AFTER UPDATE OF serial ON members FOR EACH ROW
   WHEN (OLD.serial IS DISTINCT FROM NEW.serial)
   EXECUTE FUNCTION sync_invitee_serial();
   ```

2. **`clear_search_cache_trigger_fn()` Trigger**: Instantly invalidates all entries in the `search_cache` table whenever `meetings`, `agenda`, `users`, `annexures`, `invitees`, or `agenda_tags` tables are updated.

---

## 3. Deep Dive: Core Engineering Subsystems

### 3.1 Level-Based Handover & Locking Engine

Implementation: [`meeting_service/middlewares/meetingWorkflowMiddleware.js`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/meeting_service/middlewares/meetingWorkflowMiddleware.js), [`frontend/lib/meetingAccess.ts`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/frontend/lib/meetingAccess.ts)

The workflow engine enforces institutional protocol by dynamically evaluating an editor's assigned role level ($L_{user}$) against section-specific **Lock Levels** ($L_{locked}$) and **Handover Levels** ($L_{handover}$).

#### 3.1.1 Lock Types & Access Control Matrix

The system tracks **8 distinct section locks** on each meeting record:

| Lock Name | DB Field Name | Targeted Section | Permission Formula |
|---|---|---|---|
| **Meeting Lock** | `meeting_locked_level` | Title, date, type, president, description | $\text{CanEdit} \iff L_{user} \ge L_{meeting\_locked} \lor isAdmin$ |
| **Agenda Lock** | `agenda_locked_level` | Main agenda items & annexure uploads | $\text{CanEdit} \iff L_{user} \ge L_{agenda\_locked} \lor isAdmin$ |
| **Suppli Agenda Lock** | `suppli_agenda_locked_level` | Supplementary agenda items (`is_suppli`) | $\text{CanEdit} \iff L_{user} \ge L_{suppli\_locked} \lor isAdmin$ |
| **Resolution Lock** | `resolution_locked_level` | Resolution text authoring | $\text{CanEdit} \iff L_{user} \ge L_{resolution\_locked} \lor isAdmin$ |
| **Resolution Status Lock** | `resolution_status_locked_level` | Resolution status single-select (`resolution_status` = Not Executed / Executed / Submit for Next Meeting / Custom, with display text in `execution_status` and archive flag in `is_submitted_for_next_meeting`) | $\text{CanEdit} \iff L_{user} \ge L_{res\_status\_locked} \lor isAdmin$ |
| **Invitees Lock** | `invitees_locked_level` | Invitee list & member seniority ordering | $\text{CanEdit} \iff L_{user} \ge L_{invitees\_locked} \lor isAdmin$ |
| **Presentees Lock** | `presentees_locked_level` | Attendance taking during active meeting | $\text{CanEdit} \iff L_{user} \ge L_{presentees\_locked} \lor isAdmin$ |
| **Conclusion Lock** | `conclusion_locked_level` | Meeting conclusion & wrap-up summary | $\text{CanEdit} \iff L_{user} \ge L_{conclusion\_locked} \lor isAdmin$ |

---

#### 3.1.2 Handover Lifecycle & State Transitions

Handover is designed for **stage-by-stage review escalation**:

1. **Section Handover Fields**:
   - `agenda_handover_level`
   - `suppli_agenda_handover_level`
   - `resolution_handover_level`
   - `resolution_status_handover_level`

2. **Access State Transition Logic**:
   - When Level 1 hands over to Level 2 (`agenda_handover_level = 1`):
     - **Level 1 Users ($L_{user} \le 1$)**: Edit access is **REVOKED** (read-only view).
     - **Level 2+ Users ($L_{user} > 1$)**: Edit & review access is **GRANTED**.

---

#### 3.1.3 Send-Back (Reject & Return) Feature

When a higher-level reviewer (e.g. Level 2 or Level 3) reviews a handed-over section and determines that modifications are required by lower-level authors:

- **Send-Back Condition**: User Level $L_{user} > L_{handover}$ (or `admin`).
- **Execution Flow**: The reviewer sends a section-specific send-back request (`POST /api/meetings/:id/send-back-agenda`, `POST /api/meetings/:id/send-back-suppli-agenda`, `POST /api/meetings/:id/send-back-resolution`, or `POST /api/meetings/:id/send-back-resolution-status`).
- **Database Effect**: `handover_level` is reset (or decremented to a lower integer).
- **Access Restored**: Editing rights immediately return to lower-level authors ($L_{user} \le L_{handover\_old}$), allowing them to update the draft.

---

#### 3.1.4 Middleware & Client Implementation

```javascript
// Server Middleware: meeting_service/middlewares/meetingWorkflowMiddleware.js
const calculateMeetingAccess = (meeting, user) => {
    if (!user) return emptyAccess;
    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    if (isAdmin) return fullAdminAccess;

    const userLevel = parseInt(user.role_level, 10);
    const getLock = (lvl) => (lvl !== null && lvl !== undefined ? parseInt(lvl, 10) : null);
    const getHandover = (lvl) => (lvl !== null && lvl !== undefined ? parseInt(lvl, 10) : null);

    const agendaHandover = getHandover(meeting.agenda_handover_level);
    const agendaLock = getLock(meeting.agenda_locked_level);

    let canEditAgenda = true;
    if (agendaHandover !== null && userLevel <= agendaHandover) canEditAgenda = false;
    if (agendaLock !== null && userLevel < agendaLock) canEditAgenda = false;

    const canSendBackAgenda = agendaHandover !== null && (user.role === 'admin' || userLevel > agendaHandover);
    const canUnlockAgenda = agendaLock === null || userLevel >= agendaLock;

    return { canEditAgenda, canSendBackAgenda, canUnlockAgenda, /* ... section flags */ };
};
```

---

### 3.2 3-Tier Hybrid Search Engine

Implementation: [`meeting_service/controllers/searchController.js`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/meeting_service/controllers/searchController.js), [`meeting_service/utils/searchIndexer.js`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/meeting_service/utils/searchIndexer.js)

```
                       +-------------------------------+
                       |      Incoming Search Query    |
                       +---------------+---------------+
                                       |
                                       v
                       +-------------------------------+
                       |  Check Search Cache (SHA256)  |
                       +---------------+---------------+
                                       | (Cache Miss)
                                       v
                       +-------------------------------+
                       |  Tier 0: Postgres tsvector    |
                       |      websearch_to_tsquery     |
                       +---------------+---------------+
                                       |
                       +---------------+---------------+
                       | Matches >= 30? -> Return Fast |
                       +---------------+---------------+
                                       | (No)
                                       v
                       +-------------------------------+
                       |  Tier 1: Trigram Entity Search|
                       |    (Departments, Offices)     |
                       +---------------+---------------+
                                       |
                       +---------------+---------------+
                       | Matches >= 30? -> Return Fast |
                       +---------------+---------------+
                                       | (No & Embeddings Active)
                                       v
                       +-------------------------------+
                       |  Tier 2: pgvector HNSW Search |
                       |   Embedding Vector Cosine     |
                       +---------------+---------------+
                                       |
                                       v
                       +-------------------------------+
                       |  Cache Results & Return Data  |
                       +-------------------------------+
```

#### 3.2.1 Query Parsing & SHA-256 Caching

1. `parseFilters(req)` extracts `q`, `scope` (`agenda` vs `both`), `tags`, `dateFrom`, `dateTo`, `serialFrom`, `serialTo`, and auto-enforces viewer member-type restrictions.
2. A SHA-256 key is computed over `JSON.stringify(filters)`. If present in `search_cache`, results are returned immediately (`cached: true`).

---

#### 3.2.2 Tier 0: Keyword Search Engine (Postgres `tsvector` & `'simple'` Dictionary)

##### Technical Mechanics:
- **Plain-Text Extraction**: When an agenda item is saved, `htmlToText.js` strips HTML tags to produce `content_plain` and `resolution_plain`.
- **PostgreSQL Generated Columns**:
  ```sql
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content_plain, ''))) STORED,
  resolution_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(resolution_plain, ''))) STORED
  ```
- **Why the `'simple'` Text Dictionary?**: Standard English stemmers (like Porter stemming) corrupt Bangla script by stripping word endings and suffixes, leading to false negatives. The `'simple'` dictionary tokenizes whitespace and punctuation literally without stemming, preserving both Bangla script and English words accurately.
- **SQL Execution**:
  ```sql
  SELECT a.id as agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
         'agenda' as matched_in,
         ts_rank(a.content_tsv, websearch_to_tsquery('simple', $1)) as rank,
         ts_headline('simple', coalesce(a.content_plain, ''), websearch_to_tsquery('simple', $1), 
                     'StartSel=<mark>, StopSel=</mark>, MaxWords=40, MinWords=15, MaxFragments=1') as snippet
  FROM agenda a
  JOIN meetings m ON m.id = a.meeting_id
  WHERE (a.content_tsv @@ websearch_to_tsquery('simple', $1) OR a.content_plain ILIKE '%' || $1 || '%')
    AND m.status = 'past'
  ORDER BY rank DESC
  LIMIT 30;
  ```
- **Cascading Early Exit**: If Tier 0 yields $\ge 30$ matches, execution terminates early, caches results, and returns (saving compute).

---

#### 3.2.3 Tier 1: Entity Search Engine (`gin_trgm_ops` Fuzzy Matching)

##### Technical Mechanics:
- **Problem Solved**: Agendas often mention official entity names, abbreviations, or aliases (e.g. "CSE", "সিএসই", "কম্পিউটার সায়েন্স এন্ড ইঞ্জিনিয়ারিং", "Department Head, EEE", "Vice Chancellor") that might not match query keywords verbatim.
- **Step 1: Entity Token Extraction (`findMatchingEntityTerms`)**:
  Query string `q` is split into word n-grams and matched across 6 entity tables using array substring queries (`ILIKE ANY($1)`):
  1. `departments` (`name_bangla`, `name_english`, `alias_bangla`, `alias_english`)
  2. `offices` (`name_bangla`, `name_english`)
  3. `members` (`name`)
  4. `faculties` (`name_bangla`, `name_english`)
  5. `invitees` (`name`)
  6. `agenda_entities` (`entity_name_bangla`, `entity_name_english`)
- **Step 2: Fast Trigram Matching (`runEntitySearchFast`)**:
  Collected entity names are matched against agendas using GIN trigram indexes (`idx_agenda_entities_trgm`):
  ```sql
  SELECT DISTINCT ON (a.id) a.id as agenda_id, a.meeting_id, m.title, m.type, m.meeting_date,
         'agenda' as matched_in, coalesce(substring(a.content_plain from 1 for 200), '') as snippet
  FROM agenda a
  JOIN meetings m ON m.id = a.meeting_id
  LEFT JOIN agenda_entities ae ON ae.agenda_id = a.id
  WHERE (a.content_plain ILIKE ANY($1) OR ae.entity_name_bangla ILIKE ANY($1) OR ae.entity_name_english ILIKE ANY($1))
    AND m.status = 'past'
  LIMIT 30;
  ```
- **Early Exit**: If combined Tier 0 + Tier 1 matches reach 30, execution terminates early.

---

#### 3.2.4 Tier 2: Vector Semantic Search Engine (`pgvector` HNSW + `bge-m3`)

##### Technical Mechanics:
- **Problem Solved**: Keyword and entity matching fail when users search using different phrasing, synonyms, or conceptual queries (e.g. query "শিক্ষকদের পদোন্নতি সংক্রান্ত নীতিমালা" matching an agenda titled "আবেদন বিবেচনা ও পদোন্নতি প্রক্রিয়া").
- **Text Chunking**: Long agenda bodies are split into smaller text chunks in `searchIndexer.js`.
- **`BAAI/bge-m3` Multilingual Embedding Model**:
  Query `q` is sent to `embedding_service` (`POST /embed`) to generate a 1024-dimensional normalized float vector using Hugging Face's `BAAI/bge-m3` model (trained on over 100 languages, including Bangla and English).
- **HNSW Vector Cosine Distance Search**:
  Executes cosine distance calculation `(c.embedding <=> $1::vector)` accelerated by **HNSW graph indexes** (`idx_agenda_chunks_hnsw`):
  ```sql
  SELECT c.agenda_id, a.meeting_id, m.title, m.type, m.meeting_date,
         'agenda' as matched_in, c.chunk_text as snippet,
         (c.embedding <=> $1::vector) as distance
  FROM agenda_chunks c
  JOIN agenda a ON a.id = c.agenda_id
  JOIN meetings m ON m.id = a.meeting_id
  WHERE m.status = 'past' AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> $1::vector ASC
  LIMIT 30;
  ```
- **Result Assembly**: Results are appended with `tier: 2`, `match_type: 'semantic'`.

---

#### 3.2.5 Trigger-Based Cache Invalidation

Database trigger `clear_search_cache_trigger_fn()` in [`db/init.sql`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/db/init.sql) clears `search_cache` entries automatically whenever meetings, agendas, annexures, tags, or invitees are mutated.

---

### 3.3 Asynchronous Vector Embedding Pipeline

Implementation: [`meeting_service/worker.js`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/meeting_service/worker.js), [`meeting_service/utils/searchIndexer.js`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/meeting_service/utils/searchIndexer.js)

1. When an agenda or resolution is created/updated, `indexAgendaContent()` enqueues a job on BullMQ queue `embedding-jobs`.
2. `embedding_worker` processes the queue asynchronously out-of-process.
3. **Cgroup Resource Throttling**: Before processing each job, `embedding_worker` polls container cgroup memory limits `/sys/fs/cgroup/memory.max` and CPU load averages. If free RAM $< 400\text{ MB}$ or load $> 85\%$, it delays the job using `job.moveToDelayed()` to prevent OOM kills.
4. **Reconciliation Sweep**: `startBackgroundIndexer()` periodically scans for un-indexed content (e.g., after bulk imports or service downtime).

---

### 3.4 PDF Generation & Typography Engine

Implementation: [`meeting_service/utils/pdfGenerator.js`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/meeting_service/utils/pdfGenerator.js)

- **Browser Singleton**: Manages a shared Puppeteer Chromium browser instance with launch parameters `--no-sandbox --disable-dev-shm-usage` and auto-relaunch on disconnect.
- **Embedded Bangla Typography**: Loads `SonarBangla.ttf` or `Kalpurush.ttf` from disk at startup, encodes it into a `data:font/ttf;base64` string, and injects `@font-face` directly into HTML before rendering.
- **SSRF Protection**: Request interception blocks external network calls inside Puppeteer, only permitting navigation requests and local `data:` URIs.

#### PDF Generation Functions

| Function | Purpose | Output |
|---|---|---|
| `generateMeetingPdf(id, isResolution, sectionFilter, layout?)` | Generate attendance/agenda/resolution PDF; optional `layout` from the PDF Preview page | PDF buffer |
| `generateNoticePdf(notice, presentees)` | Generate notice PDF (academic/syndicate) | PDF buffer |
| `generateNoticePdfFromPayload(payload)` | Generate PDF from form data (no DB lookup) | PDF buffer |

#### Markdown Table Conversion (`convertMarkdownTablesToHtml`)

Agenda / resolution / conclusion bodies may contain pipe-style Markdown tables (typed directly or pasted). `convertMarkdownTablesToHtml` rewrites them to real `<table>` HTML before `styleRichTextHtml` runs; anything already containing a `<table>` tag, or with no `|`, is passed through untouched.

- A block is a table when a row is immediately followed by a **separator row** — every pipe-delimited cell is only dashes with an optional leading/trailing colon (`---`, `:--`, `--:`, `:-:`, or a lone `-`).
- Robustness: entity-encoded pipes (`&#124;`, `&#x7c;`, `&vert;`), non-breaking / thin / em spaces, and autocorrected Unicode dash separators (`—`, `–`, `―`, `−`) are normalised first. Prose that merely contains a stray `|` is **not** promoted to a table.
- Generated tables carry inline cell borders and `word-wrap` so they render as a grid in both the PDF stylesheet (`th, td { border: none }`) and the DOCX path.
- Historical bug (fixed 2026-09-06): a header pre-processing step split multi-column header rows into one-cell lines, leaking the first cell as a stray `<p>` and dropping the rest of the header.

#### Per-Request Page-Layout Overrides

`normalizePdfLayout(raw)` validates and clamps an optional layout object (parsed from the `GET /api/meetings/:id/pdf/:type` query string by `meetingController.generatePdf`) into a safe shape. When nothing is supplied, generation stays on the historical A4 / 20 mm / 1× defaults, so email attachments and status sync are unaffected.

| Field | Query param(s) | Range / values | Default |
|---|---|---|---|
| `pageSize` | `pageSize` | A3, A4, A5, Letter, Legal, Tabloid | A4 |
| `orientation` | `orientation` | portrait, landscape | portrait |
| `margin` | `marginTop`, `marginRight`, `marginBottom`, `marginLeft` | 0–60 mm each | 20 mm |
| `scale` | `scale` | 0.7–1.6 | 1 |
| `lineHeight` | `lineHeight` | 1–3, or empty for the template default | null |
| `agendaNumberStyle` | `agendaNumberStyle` | `heading` (bold "প্রস্তাব নং <n>" line) or `inline` (bold `<prefix><n>:` run opening the body) | heading |
| `separatePages` | `separatePages` | `true`, `false` — for resolution PDFs, prints each resolution item starting on a new page | false |

A non-default layout is hashed into its own PDF cache key (`<type>--l<sha1>`) and added as a `layout` dimension of the content fingerprint, so it never clobbers the canonical default-layout PDF; custom-layout variants are cache-only and are **not** mirrored to the meeting filesystem.

#### Notice PDF Features

- **Dynamic body generation**: Auto-generates notice body based on type (invitation/agenda/resolution) and meeting status
- **Bangla date formatting**: Uses Bengali month names and Bangla numeral conversion
- **Members list rendering**: Auto-appends member list after signature for syndicate notices
- **Null name handling**: Splits office_name by comma when name is null
- **Resolution presentee columns**: Dynamic 1/2 column layout based on presentee count (>15 → 2 columns at 9px; ≤15 → 1 column at 12px)

---

### 3.5 MinIO S3 Object Storage & Authenticated Stream Proxy

Implementation: [`meeting_service/utils/storageService.js`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/meeting_service/utils/storageService.js), [`meeting_service/controllers/storageController.js`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/meeting_service/controllers/storageController.js), [`meeting_service/routes/storageRoutes.js`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/meeting_service/routes/storageRoutes.js), [`nginx/nginx.conf`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/nginx/nginx.conf)

1. **File Storage Backend**:
   - Files uploaded as annexures (`annexures/<agenda_id>/...`), signed meeting materials (`materials/<meeting_id>/...`), or audit log archives (`audit-log-archives/...`) are written to MinIO via `@aws-sdk/client-s3`.
   - Upload and deletion operations are restricted to authorized workflow roles (`requireMeetingOperator` middleware enforcing Editor, Operator, Admin, or Superadmin permissions).
2. **Authenticated Gateway Proxy Architecture**:
   - Public access to MinIO port `9000` is completely disabled. MinIO remains internal to the Docker network.
   - NGINX intercepts external request paths under `/storage/(.*)` and rewrites them to `/api/storage/$1`, proxying directly to `meeting_service:8001`.
3. **Session Authentication & Granular Access Control (`checkFileAccess`)**:
   - All file requests are processed through `storageRoutes.js` with `authMiddleware` enforcing valid session tokens (via `Authorization: Bearer` headers, `token` query parameters, or HttpOnly session cookies).
   - `checkFileAccess(key, user)` evaluates permissions dynamically against the database:
     - **Draft Protection**: Viewers (`role === 'viewer'`) are strictly blocked from accessing files belonging to draft meetings (`status === 'draft'`), returning HTTP 404 (File not found).
     - **Member-Type Scoping**: Viewers with `member_type === 'academic'` are restricted strictly to `academic` meeting files; viewers with `member_type === 'syndicate'`, `none`, or unassigned can access both `academic` and `syndicate` completed meeting files.
4. **Direct Authenticated Streaming (`streamFile`)**:
   - Authorized requests invoke `storageService.getFileStream(key)` using `@aws-sdk/client-s3` `GetObjectCommand`.
   - `meeting_service` sets appropriate HTTP headers (`Content-Type`, `Content-Length`) and pipes the binary stream directly to the client response (`stream.pipe(res)`), ensuring zero exposure of bucket credentials or unauthenticated links.

---

### 3.6 JSON Import & Regex Entity Resolution Engine

Implementation: [`frontend/lib/departmentMergeRules.ts`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/frontend/lib/departmentMergeRules.ts), [`MERGE_RULES.md`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/MERGE_RULES.md)

When historical meetings are uploaded via `JsonImportDialog`, input strings are matched against ordered regex patterns to resolve canonical university departments:

```typescript
export const DEPARTMENT_MERGE_RULES = [
    { pattern: /তড়িৎ|ইলেক/, target: "Electrical and Electronic Engineering" },
    { pattern: /কম্পিউটার/, target: "Computer Science and Engineering" },
    { pattern: /ইন্ডাষ্ট্রিয়াল|ইন্ড্রাষ্ট্রিয়াল|আই[,.\s]*পি[,.\s]*ই/, target: "Industrial and Production Engineering" },
    // ... Additional rules in priority order
];
```

---

### 3.7 Audit Logging & Session Management

- **Pure Token-Based Authentication**: Cookies are completely eliminated. Authentication and authorization rely exclusively on session tokens stored client-side in browser `sessionStorage` (with `localStorage` fallback to initialize new tabs with the latest session).
- **Tab-Isolated Session Propagation**: API requests attach the tab's `sessionStorage` token via `Authorization: Bearer <token>` headers, and file navigation links attach `?token=<token>`, guaranteeing strict session isolation across tabs.
- **Audit Logs**: Shared PostgreSQL `audit_logs` table tracking `userId`, `username`, `action`, `entityType`, `entityId`, `details` (JSONB), and `ipAddress`.
- **Active Session Tracking**: Users can inspect active device sessions, IP addresses, and remote locations, with the option to remotely terminate individual sessions or execute global logout across all devices (`/signout-all`).

---

## 4. API Endpoint Reference

### 4.1 Authentication Service (`/api/auth`)

| Method | Endpoint | Access Level | Description |
|---|---|---|---|
| `POST` | `/api/auth/signin` | Public | Authenticate user and issue session token & cookie |
| `POST` | `/api/auth/signout` | Authenticated | Terminate current session |
| `POST` | `/api/auth/signout-all` | Authenticated | Terminate all sessions for the user |
| `GET` | `/api/auth/me` | Authenticated | Retrieve current user profile and role level |
| `POST` | `/api/auth/verify-password` | Authenticated | Verify user session password |
| `PUT` | `/api/auth/me` | Authenticated | Update user email or change password |
| `GET` | `/api/auth/sessions` | Authenticated | List all active sessions for current user |
| `DELETE` | `/api/auth/sessions/:id` | Authenticated | Terminate a specific remote session |
| `POST` | `/api/auth/signup` | Editor/Admin | Create a new user account |
| `GET` | `/api/auth/users` | Editor/Admin | List user accounts |
| `PUT` | `/api/auth/users/:id` | Editor/Admin | Modify user details or role level |
| `PATCH` | `/api/auth/users/:id/status` | Editor/Admin | Change account status (`active`/`inactive`) |
| `DELETE` | `/api/auth/users/:id` | Editor/Admin | Delete a user account |
| `POST` | `/api/auth/upload-csv` | Admin | Transactional bulk import of users from CSV |
| `GET` | `/api/auth/download-csv` | Admin | Export all user accounts as CSV |
| `GET` | `/api/auth/roles` | Authenticated | List level roles |
| `POST` | `/api/auth/roles` | Editor/Admin | Create a new level role |
| `PUT` | `/api/auth/roles/reorder` | Editor/Admin | Reorder level roles |
| `PUT` | `/api/auth/roles/:id` | Editor/Admin | Update level role title or numeric level |
| `DELETE` | `/api/auth/roles/:id` | Editor/Admin | Delete a level role |
| `GET` | `/api/auth/settings` | Authenticated | Retrieve system settings |
| `PUT` | `/api/auth/settings` | Editor/Admin | Update system settings (`min_completed_level`) |

---

### 4.2 Meeting Service (`/api/meetings`, `/api/agendas`, etc.)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/meetings` | List council meetings (supports type/status filtering) |
| `POST` | `/api/meetings` | Create a new council meeting |
| `POST` | `/api/meetings/bulk-import` | Bulk import historical meetings from structured JSON |
| `GET` | `/api/meetings/:id` | Get detailed meeting information including access rights |
| `GET` | `/api/meetings/:id/history` | View audit trail and history log for a specific meeting |
| `PUT` | `/api/meetings/:id` | Update meeting title, date, or metadata |
| `PUT` | `/api/meetings/:id/signatures` | Update per-meeting president & secretary signatures (blank values allowed) |
| `PUT` | `/api/meetings/:id/online-link` | Update online video conference link |
| `DELETE` | `/api/meetings/:id` | Delete meeting and associated agendas/annexures |
| `POST` | `/api/meetings/:id/handover-agenda` | Hand over main agendas to higher level |
| `POST` | `/api/meetings/:id/handover-suppli-agenda` | Hand over supplementary agendas to higher level |
| `POST` | `/api/meetings/:id/handover-resolution` | Hand over resolutions to higher level |
| `POST` | `/api/meetings/:id/handover-resolution-status` | Hand over resolution execution tracking to higher level |
| `POST` | `/api/meetings/:id/send-back-agenda` | Send back main agendas to lower level |
| `POST` | `/api/meetings/:id/send-back-suppli-agenda` | Send back supplementary agendas to lower level |
| `POST` | `/api/meetings/:id/send-back-resolution` | Send back resolutions to lower level |
| `POST` | `/api/meetings/:id/send-back-resolution-status` | Send back resolution execution status to lower level |
| `POST` | `/api/meetings/:id/lock-:section` | Lock section (`agenda`, `suppli-agenda`, `resolution`, `resolution-status`, `meeting`, `invitees`, `presentees`, `conclusion`) |
| `POST` | `/api/meetings/:id/unlock-:section` | Unlock section (`agenda`, `suppli-agenda`, `resolution`, `resolution-status`, `meeting`, `invitees`, `presentees`, `conclusion`) |
| `POST` | `/api/meetings/:id/complete` | Finalize and complete meeting |
| `GET` | `/api/meetings/:id/pdf/:type` | Download rendered PDF (`agenda`, `suppli-agenda`, `resolution`, `resolution-status`, `attendance`). Optional page-layout query params (`pageSize`, `orientation`, `marginTop/Right/Bottom/Left`, `scale`, `lineHeight`, `agendaNumberStyle`) from the PDF Preview page — see §3.4 |
| `POST` | `/api/meetings/:id/send-email` | Send agenda booklet via email |
| `POST` | `/api/meetings/:id/send-notice` | Send meeting notice email to selected invitees (draft/ongoing only; rejected for immediate meetings) |
| `POST` | `/api/meetings/:id/send-agenda-email` | Send agenda email with PDF attached to selected invitees (ongoing only) |
| `POST` | `/api/meetings/:id/send-resolution-email` | Send resolution email with PDF attached to selected invitees (completed only) |
| `GET` | `/api/meetings/:id/email-drafts` | Fetch saved email drafts (`{ notice, agenda, resolution }`, one slot per type) |
| `PUT` | `/api/meetings/:id/email-drafts/:mode` | Save/overwrite the draft for `notice`/`agenda`/`resolution` (invitee subset + from/subject/body/attach flag/base64 attachments) |
| `DELETE` | `/api/meetings/:id/email-drafts/:mode` | Discard the saved draft for a type |
| `POST` | `/api/meetings/:id/materials/upload` | Upload signed meeting materials attachment |
| `GET` | `/api/meetings/:id/invitees` | List meeting invitees (includes `notice_mail_sent`, `agenda_mail_sent`, `resolution_mail_sent` flags) |
| `GET` | `/api/meetings/:id/invitees/emails` | List invitees with email addresses for email sending modal (lightweight projection) |
| `POST` | `/api/meetings/:id/invitees` | Add invitees/members to meeting |
| `PUT` | `/api/meetings/:id/invitees/:inviteeId` | Update invitee details |
| `DELETE` | `/api/meetings/:id/invitees/:inviteeId` | Remove invitee from meeting |
| `PUT` | `/api/meetings/:id/invitees/:inviteeId/reorder` | Reorder invitee seniority serial |
| `POST` | `/api/meetings/:id/invitees/bulk-fetch` | Bulk fetch invitees from member list |
| `GET` | `/api/meetings/:id/presentees` | List presentees for meeting |
| `POST` | `/api/meetings/:id/presentees` | Add presentees to meeting |
| `PUT` | `/api/meetings/:id/presentees/:presenteeId` | Update presentee status |
| `DELETE` | `/api/meetings/:id/presentees/:presenteeId` | Remove presentee from meeting |
| `PUT` | `/api/meetings/:id/attendance` | Batch save attendance status |
| `POST` | `/api/agendas` | Add an agenda item to a meeting |
| `PUT` | `/api/agendas/:id` | Update agenda item content or resolution |
| `DELETE` | `/api/agendas/:id` | Remove agenda item |
| `POST` | `/api/agendas/reorder` | Reorder agenda items within a meeting |
| `PUT` | `/api/agendas/:id/archive` | Archive an agenda item (move to archive box) |
| `PUT` | `/api/agendas/:id/copy-to-archive` | Copy agenda to archive for next meeting (resolution status) |
| `PUT` | `/api/agendas/:id/remove-from-archive` | Remove archived copy and unset submitted flag |
| `GET` | `/api/agendas/archived` | List archived agenda items |
| `POST` | `/api/agendas/meeting/:meetingId/restore-archived` | Restore archived items to meeting |
| `DELETE` | `/api/agendas/archived/:id` | Permanently delete archived item |
| `GET` | `/api/agendas/:id/revisions` | View revision history for an agenda item |
| `POST` | `/api/agendas/:id/annexures` | Upload annexure attachment to an agenda item |
| `PUT` | `/api/agendas/resolutions/:resId/execution` | Update resolution status (single-select: `status` = `not_executed` \| `executed` \| `submitted` \| `custom` plus `execution_status` display text for that status — prefilled defaults: Not Executed `অবাস্তবায়িত`, Executed `বাস্তবায়িত`, Submit `পরবর্তী মিটিং এ উপস্থাপনের জন্য আবেদন করা হল`, Custom blank; blank text rejected; backend enforces exclusivity and creates/removes the archive copy) |
| `GET` | `/api/members` | List university council members |
| `POST` | `/api/members` | Add a new member |
| `PUT` | `/api/members/:id` | Update member information |
| `PUT` | `/api/members/reorder` | Reorder member seniority serials |
| `POST` | `/api/members/fetch-external` | Fetch external members |
| `POST` | `/api/departments/upload-csv` | Bulk import departments from CSV |
| `GET` | `/api/departments/download-csv` | Export department catalog as CSV |
| `POST` | `/api/offices/upload-csv` | Bulk import offices from CSV |
| `GET` | `/api/offices/download-csv` | Export office registry as CSV |
| `POST` | `/api/faculties/upload-csv` | Bulk import faculties from CSV |
| `GET` | `/api/faculties/download-csv` | Export faculty catalog as CSV |
| `GET` | `/api/templates/search` | Search template library |
| `PATCH` | `/api/templates/:id/visibility` | Update template visibility |
| `POST` | `/api/templates/:id/use` | Increment template use count |
| `GET` | `/api/audit-logs` | Retrieve system audit logs |
| `GET` | `/api/audit-logs/archives` | Retrieve audit log archive downloads (Admin only) |

#### Notice API (`/api/notices`)

| Method | Endpoint | Access Level | Description |
|---|---|---|---|
| `GET` | `/api/notices/settings/signatures` | Admin/Superadmin/Moderator | Retrieve academic and syndicate signature text |
| `PUT` | `/api/notices/settings/signatures` | Admin/Superadmin/Moderator | Update signature text for academic or syndicate notices |
| `GET` | `/api/notices/settings/signed-persona` | Admin/Superadmin/Moderator | Retrieve signed persona defaults (president & secretary) |
| `PUT` | `/api/notices/settings/signed-persona` | Admin/Superadmin/Moderator | Update signed persona defaults (supports blank values) |
| `POST` | `/api/notices/generate-pdf` | Admin/Superadmin/Moderator | Generate notice PDF on-the-fly from payload (no persistence) |

---

### 4.3 Search API (`/api/search`)

| Method | Endpoint | Query Parameters | Description |
|---|---|---|---|
| `GET` | `/api/search` | `q`, `scope`, `tags`, `dateFrom`, `dateTo`, `serialFrom`, `serialTo` | Execute 3-Tier Hybrid Search |

---

### 4.4 Storage API (`/api/storage` & `/storage`)

| Method | Endpoint | Access Level | Description |
|---|---|---|---|
| `GET` | `/storage/*key` | Authenticated | Public gateway entrypoint. NGINX rewrites `/storage/(.*)` to `/api/storage/$1` and proxies to `meeting_service` |
| `GET` | `/api/storage/*key` | Authenticated | Validates session authentication & `checkFileAccess` permissions, streaming the file payload directly from MinIO with `Content-Type` headers |

---

### 4.5 Embedding Service API (`http://embedding_service:8002`)

| Method | Endpoint | Payload | Description |
|---|---|---|---|
| `GET` | `/health` | None | Returns status and active Hugging Face model |
| `POST` | `/embed` | `{"texts": ["text string"]}` | Computes 1024-dim normalized vector embeddings |

---

## 5. Frontend Architecture & Design System

The frontend application is built using **Next.js 15 App Router**, **TypeScript**, **Tailwind CSS**, and **SWR**.

> 📌 **FRONTEND ROUTE ARCHITECTURE NOTE**: There are **no `/admin/*` routes** in the application. All management dashboards, user administration, and organizational settings are housed within `/workspace/*`:

```
frontend/app/
├── login/                  -> Authentication page
├── workspace/              -> Workspace dashboard container
│   ├── meetings/           -> Meeting management table & controls
│   ├── users/              -> User accounts & Role Level management
│   ├── members/            -> Member registry & serial ordering
│   ├── departments/        -> Department catalog & alias rules
│   ├── offices/            -> Office registry
│   ├── faculties/          -> Faculty catalog
│   ├── templates/          -> Agenda & Resolution templates
│   └── audit-log/          -> Audit trail viewer
├── meetings/[id]/          -> Interactive multi-tab meeting editor
├── search/                 -> 3-Tier Hybrid Search interface
├── viewer/                 -> Read-only portal for council members
└── profile/                -> Profile, password & active session manager
```

- **Client-Side Permission Integration**:
  - `lib/meetingAccess.ts`: Mirror calculation helper providing boolean flags (`canEditAgenda`, `canSendBackAgenda`, `canLockAgenda`, etc.) consumed by UI components.
  - `components/meetings/MeetingWorkflowBar.tsx`: Dynamic action toolbar rendering Handover, Send-Back, Lock, and Unlock buttons based on permissions.

### 5.1 Email Tab — Meeting Notification & Document System

Implementation: [`frontend/components/meetings/EmailTabView.tsx`](frontend/components/meetings/EmailTabView.tsx), [`frontend/components/meetings/SendAgendaModal.tsx`](frontend/components/meetings/SendAgendaModal.tsx), [`frontend/components/meetings/NoticeView.tsx`](frontend/components/meetings/NoticeView.tsx), [`meeting_service/controllers/meetingController.js`](meeting_service/controllers/meetingController.js)

The Email tab provides a centralized interface for both sending meeting-related emails and generating notice documents. It is organized into two sub-tabs:

#### Sub-Tab Structure

| Sub-Tab | Content | Access |
|---|---|---|
| **Email** | Email sending UI (notice, agenda, resolution emails) | All users with Email tab access |
| **Email Document** | Notice PDF generation form (academic/syndicate) | Admin/Superadmin/Moderator only |

#### Roles & Permissions

| Role | Can Send Emails | Can Generate Documents |
|---|---|---|
| `admin` | Yes | Yes |
| `superadmin` | Yes | Yes |
| `moderator` | Yes | Yes |
| `editor` / `viewer` / `file_initiator` | No | No |

The backend enforces this via `requireEmailSender` (for notice/agenda) and `requireCompletedMeetingEmailSender` (for resolution) middlewares in [`meetingWorkflowMiddleware.js`](meeting_service/middlewares/meetingWorkflowMiddleware.js).

#### Status-Based Enable/Disable Rules

Each email type is only available at a specific meeting lifecycle stage:

| Email Type | Enabled When | Backend Guard | Button State |
|---|---|---|---|
| **Send Notice** | `status === 'draft'` only | `requireEmailSender` (blocks `is_completed`) | Enabled: draft. Disabled: ongoing, past/completed. |
| **Send Agenda** | `status === 'ongoing'` only | `requireEmailSender` + controller checks `status !== 'ongoing'` | Enabled: ongoing. Disabled: draft, past/completed. |
| **Send Resolution** | `is_completed === true` or `status === 'past'` | `requireCompletedMeetingEmailSender` (requires `is_completed`) | Enabled: completed/past. Disabled: draft, ongoing. |

Immediate meetings (`is_regular === false`) have no notice section — the Email tab shows only the Agenda and Resolution cards. The backend enforces this: `sendNoticeEmail` and notice-mode draft saves return `400` for immediate meetings.

#### Thumb-Up Rule (All-Sent Disable)

A button is also disabled when **all** invitees with email addresses have already received that email type. The UI shows an "All notified" / "All sent" badge and greys out the button:

- **Notice**: disabled when `inviteesWithEmail.every(i => i.notice_mail_sent)`
- **Agenda**: disabled when `inviteesWithEmail.every(i => i.agenda_mail_sent)`
- **Resolution**: disabled when `inviteesWithEmail.every(i => i.resolution_mail_sent)`

#### Email Modal (SendAgendaModal)

The modal operates in four modes (`EmailMode`): `"notice"`, `"agenda"`, `"resolution"`, `"custom"`.

| Mode | Subject Template | Body Template | PDF Attachment | Endpoint |
|---|---|---|---|---|
| `notice` | `সভার সংবাদনা (...)` | Bangla notice body | None | `POST /:id/send-notice` |
| `agenda` | `সভার এজেন্ডা (...)` | Bangla agenda body | `generateMeetingPdf(id, false)` | `POST /:id/send-agenda-email` |
| `resolution` | `সভার সিদ্ধান্ত (...)` | Bangla resolution body | `generateMeetingPdf(id, true)` | `POST /:id/send-resolution-email` |
| `custom` | User-editable | Rich text editor (user-composed) | Optional | `POST /:id/send-email` |

All email modes embed a **dynamic meeting link** (`${window.location.origin}/meetings/${meeting.id}`) in the HTML body. In development this resolves to `http://localhost:9001/meetings/...`; in production it resolves to the deployed domain.

#### Database Tracking

Each invitee row tracks email receipt via boolean flags in the `invitees` table:

```sql
notice_mail_sent    BOOLEAN DEFAULT false
agenda_mail_sent    BOOLEAN DEFAULT false
resolution_mail_sent BOOLEAN DEFAULT false
```

The backend sets the corresponding flag to `true` after all recipients in a batch have been processed, ensuring idempotent re-sends are safe (already-sent invitees are filtered out on subsequent calls).

---

### 5.2 Notice PDF Generation — On-the-Fly Document Engine

Implementation: [`frontend/components/meetings/NoticeView.tsx`](frontend/components/meetings/NoticeView.tsx), [`meeting_service/controllers/noticeController.js`](meeting_service/controllers/noticeController.js), [`meeting_service/utils/pdfGenerator.js`](meeting_service/utils/pdfGenerator.js)

The Notice Document sub-tab provides a form-based interface for generating notice PDFs on-the-fly. PDFs are not persisted to the database — they are generated from form data each time.

#### Notice Types

| Type | Academic | Syndicate |
|---|---|---|
| **Invitation** | `academic-invitation` | `syndicate-invitation` |
| **Agenda** | `academic-agenda` | `syndicate-agenda` |
| **Resolution** | `academic-resolution` | `syndicate-resolution` |
| **Immediate** | `academic-immediate` | `syndicate-immediate` |

Both academic and syndicate meetings can be **Regular or Immediate** (`is_regular`). Immediate meetings of either type have no invitation notice, and their agenda / resolution prefill shares one wording that differs only by council name (`সিন্ডিকেটের` vs `একাডেমিক কাউন্সিলের`).

#### Key Features

1. **Auto-Prefill**: Notice body is automatically generated based on meeting type, notice type, and meeting date. Serial numbers are displayed in Bangla digits with "নং" suffix (e.g., `১ নং সভা`). The invitation prefill (like agenda/resolution) now includes a `• web link for meeting:` line with the meeting URL; the backend empty-body fallback (`generateDefaultBody`) carries the same link.

2. **Signature Management**: Signatures are stored permanently in `system_settings` table and auto-reflected in the UI when updated via the signature settings modal.

3. **Members List**: For syndicate notices, a members list is automatically appended after the signature:
   - Single column layout when members < 16
   - Two-column layout when members ≥ 16
   - উপাচার্য (Vice Chancellor) displayed as সভাপতি (President)
   - All others displayed as সদস্য (Member)

4. **Null Name Handling**: When an invitee's name is null, the system splits `office_name` by comma — first part becomes the name, remaining parts become the office detail.

5. **PDF Layout**:
   - Reduced signature section margins (30px top, 40px height) to keep members on same page
   - Members list flows immediately after letter body
   - Dynamic column layout for resolution presentees (>15 → 2 columns at 9px; ≤15 → 1 column at 12px)

#### Backend API

```javascript
// Generate PDF on-the-fly (no persistence)
POST /api/notices/generate-pdf
Body: {
  meeting_id: "uuid",
  notice_number: "123",
  notice_date: "2026-07-30T10:00:00Z",
  notice_type: "academic-agenda",  // or "syndicate-resolution", etc.
  body: "<p>HTML body content</p>",
  signature_text: "(অধ্যাপক ড. এন.এম. গোলাম জাকারিয়া)\nরেজিস্ট্রার (অ. দা.)"
}
Response: PDF binary stream (Content-Type: application/pdf)
```

#### Font Requirements

- **Primary**: `Kalpurush.ttf` (Bangla typesetting)
- **Secondary**: `SonarBangla.ttf` (alternative font, must be placed in `meeting_service/utils/fonts/`)
- Font files are loaded at Puppeteer startup and embedded as base64 data URIs

---

### 5.3 Attendance Sheet — Section-Separated PDF Generation

Implementation: [`meeting_service/utils/pdfGenerator.js`](meeting_service/utils/pdfGenerator.js)

The attendance PDF generator produces two variants via the `generateMeetingPdf(id, isResolution, sectionFilter)` function:

1. **Full Attendance Sheet** (no `sectionFilter`): Includes all invitees grouped by their original seniority order — VC & Pro-VC, Deans, Department Heads, Department groups, and Others.

2. **Section-Filtered Attendance Sheet** (with `sectionFilter`): Generates a PDF containing only invitees belonging to a specific section/category. This is useful when different departments or groups need their own attendance copy.

#### Grouping Categories

Invitees are categorized using the same logic as the frontend `TakeAttendanceView`:

| Group | Detection Logic | Example |
|---|---|---|
| **VC & Pro-VC** (`প্রশাসন`) | Designation contains `উপাচার্য` (excl. `উপ-উপাচার্য`) or `উপ-উপাচার্য` | Vice Chancellor, Pro-Vice Chancellor |
| **Deans** (`সকল ডিন`) | Office name contains `ডিন` or `dean` | ডিন, ফ্যাকাল্টি অব ইঞ্জিনিয়ারিং অ্যান্ড টেকনোলজি |
| **Department Heads** (`সকল বিভাগীয় প্রধান`) | Office name contains `বিভাগীয় প্রধান` | বিভাগীয় প্রধান, CSE |
| **Department Groups** | Linked via `department_id` → `departments.name_bangla` | কম্পিউটার সায়েন্স অ্যান্ড ইঞ্জিনিয়ারিং, তড়িৎ ও ইলেকট্রনিক ইঞ্জিনিয়ারিং |
| **Others** (`অন্যান্য সদস্য`) | No department, no special designation | External invitees, non-member officials |

#### Section Filter Examples

When `sectionFilter` is provided (e.g., `"কম্পিউটার সায়েন্স অ্যান্ড ইঞ্জিনিয়ারিং"`), the PDF renders only:

```
┌──────────────────────────────────────────────┐
│  বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয় (বুয়েট)     │
│  সিন্ডিকেট কাউন্সিলের সভা নং ১২              │
│  উপস্থিতি তালিকা                              │
│──────────────────────────────────────────────│
│  কম্পিউটার সায়েন্স অ্যান্ড ইঞ্জিনিয়ারিং       │
│──────────────────────────────────────────────│
│  ক্রমিক │ নাম              │ পদবী           │
│─────────┼──────────────────┼─────────────────│
│  ১      │ Prof. Ahmed      │ বিভাগীয় প্রধান  │
│  ২      │ Dr. Rahman       │ সহকারী অধ্যাপক  │
│  ৩      │ Ms. Fatima       │ লেকচারার        │
└──────────────────────────────────────────────┘
```

For the full attendance sheet, all groups appear sequentially:

```
┌──────────────────────────────────────────────┐
│  ... (university header) ...                 │
│  উপস্থিতি তালিকা                              │
│──────────────────────────────────────────────│
│  প্রশাসন                                      │
│  (VC, Pro-VC listed)                         │
│──────────────────────────────────────────────│
│  সকল ডিন                                     │
│  (All deans listed)                          │
│──────────────────────────────────────────────│
│  সকল বিভাগীয় প্রধান                           │
│  (All dept heads listed)                     │
│──────────────────────────────────────────────│
│  কম্পিউটার সায়েন্স অ্যান্ড ইঞ্জিনিয়ারিং       │
│  (CSE members listed)                        │
│──────────────────────────────────────────────│
│  তড়িৎ ও ইলেকট্রনিক ইঞ্জিনিয়ারিং               │
│  (EEE members listed)                        │
│──────────────────────────────────────────────│
│  ... (other departments) ...                 │
│──────────────────────────────────────────────│
│  অন্যান্য সদস্য                                │
│  (Others listed)                             │
└──────────────────────────────────────────────┘
```

The section filter is applied at the data level before rendering — `buildSingleGroupSections()` produces a single group array, while `buildAllSections()` produces the full categorized list.

---

### 5.4 Take Attendance — Search & Filter

Implementation: [`frontend/components/meetings/TakeAttendanceView.tsx`](frontend/components/meetings/TakeAttendanceView.tsx)

The Take Attendance page includes a search bar for filtering invitees by multiple fields:

- **Searchable fields**: `name`, `designation`, `department_name`, `office_name`
- **Case-insensitive**: All comparisons use `.toLowerCase()`
- **Real-time filtering**: Results update on every keystroke via `useMemo`
- **Placeholder**: `"Search by name, designation, department, or office..."`

The search bar is embedded inline within the attendance summary bar (alongside the present/total count) for a compact layout. A clear button (`X`) appears when the search query is non-empty.

---

### 5.5 Resolution PDF — Dynamic Column Layout

Implementation: [`meeting_service/utils/pdfGenerator.js`](meeting_service/utils/pdfGenerator.js)

The resolution PDF generator dynamically adjusts the layout of the presentees (attendees) section based on the number of presentees:

| Presentee Count | Column Layout | Font Size |
|---|---|---|
| ≤ 15 presentees | Single column | 12px |
| > 15 presentees | Two columns | 9px |

This optimization ensures:
- **Small meetings**: Readable single-column layout with larger font
- **Large meetings**: Compact two-column layout to fit all names on fewer pages

The layout is applied in the `generatePdf()` function when rendering the presentees list in the resolution PDF.

---

### 5.6 Signed Persona — Resolution Signature Configuration

Implementation: [`frontend/components/meetings/SignedPersonaView.tsx`](frontend/components/meetings/SignedPersonaView.tsx), [`meeting_service/controllers/meetingController.js`](meeting_service/controllers/meetingController.js), [`meeting_service/controllers/noticeController.js`](meeting_service/controllers/noticeController.js)

The Signed Persona tab allows users to configure president and secretary signature text that appears at the bottom of resolution PDFs. It supports both per-meeting overrides and global defaults.

#### Architecture

| Level | Storage | Scope | Fallback |
|---|---|---|---|
| **Per-Meeting** | `meetings.president_signature`, `meetings.secretary_signature` | Single meeting | Falls back to global default |
| **Global Default** | `system_settings` (4 keys) | All meetings of same type | Blank if not set |

#### Database Keys (system_settings)

| Key | Description |
|---|---|
| `academic_president_signature` | Default president signature for academic meetings |
| `academic_secretary_signature` | Default secretary signature for academic meetings |
| `syndicate_president_signature` | Default president signature for syndicate meetings |
| `syndicate_secretary_signature` | Default secretary signature for syndicate meetings |

#### Resolution PDF Signature Block

The signature block renders at the bottom of resolution PDFs with:
- Two-column layout (president left, secretary right)
- 80px signature space (no border line)
- Centered text below each signature space
- Blank sections render with empty space when no signature text is provided

#### Fallback Logic

```javascript
// In generatePdf():
let presidentSignature = meeting.president_signature || '';
let secretarySignature = meeting.secretary_signature || '';

// If meeting-specific signatures are empty, fetch defaults
if (!presidentSignature || !secretarySignature) {
    const sigResult = await pool.query(
        `SELECT key, value FROM system_settings WHERE key IN ($1, $2)`,
        [presidentKey, secretaryKey]
    );
    // Only fill in empty values (preserve meeting-specific ones)
}
```

#### RBAC

Same as Notice — only `admin`, `superadmin`, `moderator` can access Signed Persona tab.

#### API Endpoints

| Method | Endpoint | Access Level | Description |
|---|---|---|---|
| `GET` | `/api/notices/settings/signed-persona` | Admin/Superadmin/Moderator | Fetch global default signatures |
| `PUT` | `/api/notices/settings/signed-persona` | Admin/Superadmin/Moderator | Update global default signatures (blank values allowed) |
| `PUT` | `/api/meetings/:id/signatures` | Non-Viewer | Update per-meeting signatures (blank values allowed) |


### 5.7 Resolution Status — Single-Select UI

Implementation: [`frontend/components/meetings/ResolutionView.tsx`](frontend/components/meetings/ResolutionView.tsx), [`meeting_service/controllers/agendaController.js`](meeting_service/controllers/agendaController.js) (`updateExecutionStatus`)

Past meetings with a resolution show an Execution Status block with four radio buttons in a horizontal layout — exactly one selectable at a time: Not Executed, Executed, Submit for Next Meeting, Custom (default: Not Executed).

#### Flexible per-status values

Each status owns its display text (saved to `agenda.execution_status`, rendered as-is in the resolution-status PDF). Defaults live in a single map, so they can be fixed in one place:

| Status | Default text |
|---|---|
| Not Executed | `অবাস্তবায়িত` |
| Executed | `বাস্তবায়িত` |
| Submit for Next Meeting | `পরবর্তী মিটিং এ উপস্থাপনের জন্য আবেদন করা হল` |
| Custom | blank (`''`) |

The selected status itself is stored in `agenda.resolution_status` (explicit source of truth — edited Not-Executed text is therefore never mistaken for Custom). Blank text is rejected by both frontend and backend (`400`).

#### Simple text input (no rich text editor)

The status value field is a plain text input: it loads prefilled with the status default (or the saved text when re-editing), with Edit / Save / Cancel buttons. Preset statuses (Not Executed, Executed, Submit) auto-save their default text on radio select and remain editable via Edit afterwards; Custom opens a blank input and requires manual Save (blank/unsaved falls back to the previous selection). Selecting Submit archives the agendum (`copy-to-archive`); switching away removes the archive copy unless it was already deleted from the archive list.

### 5.8 Rich Text Editor — Word-Style Ribbon & Multi-Theme System

Implementation: [`frontend/components/RichTextEditor.tsx`](frontend/components/RichTextEditor.tsx) (TipTap 3 / ProseMirror), [`frontend/app/globals.css`](frontend/app/globals.css), [`frontend/components/ThemeProvider.tsx`](frontend/components/ThemeProvider.tsx), [`frontend/components/ThemeToggle.tsx`](frontend/components/ThemeToggle.tsx).

The agenda/resolution editor is a Microsoft Word–style ribbon UI built on TipTap, used everywhere rich text is authored (agenda bodies, supplementary agendas, resolutions). The ribbon has six tabs: **Home** (font/paragraph/styles), **Insert** (tables, links, equations, symbols, callouts), **Page Layout**, **Table Tools** (contextual — only shown with the cursor inside a table), **Bijoy & Tools** (Bijoy→Unicode conversion, Bangla virtual keyboard), and **View**.

#### Page Layout Tab

- **Page Setup**: Margins (Normal/Narrow/Moderate/Wide presets or custom mm), Orientation (Portrait/Landscape), Size (A4/Letter/Legal/A3) — these drive the "Word A4 Page" view's actual rendered dimensions (`width`/`min-height`/`padding` computed from `PageSettings` state), not just cosmetic labels.
- **Columns & Breaks**: 2/3-column text layout, Page Break, Column Break.
- **Page Background**: Watermark (text/color/opacity, diagonal overlay), Page Color, Page Borders (style/width/color).

Ribbon dropdowns (Page Layout's included) render through a `LayoutPopover` helper that portals to `document.body` with `position: fixed`. This is required, not cosmetic: the ribbon toolbar sets `overflow-x-auto`, and per the CSS spec, setting only one of `overflow-x`/`overflow-y` forces the other to compute as `auto` too — so a plain `position: absolute` dropdown gets silently clipped by the ribbon's own height. Any new ribbon dropdown must use `LayoutPopover` (or an equivalent portal) rather than `absolute` positioning.

#### Table Tools Tab

Columns/Rows insert & delete, Row Height presets, Cell Shading, Vertical Alignment (Top/Middle/Bottom), Merge/Split Cells, Split/Merge Tables, Rotate Text 90°, per-cell bullet/number list styling, a 6-option Border style picker (`data-border` attribute), a 4-preset Table Style gallery (`data-table-style` — Plain/Blue Grid/Gray Bands/Crimson Header) and Table Alignment on the page (`data-align`). Row/column dragging is handled by TipTap's built-in column resizing plus a custom `rowResizing` ProseMirror plugin ([`frontend/lib/tableRowResizing.ts`](frontend/lib/tableRowResizing.ts)) that mirrors it for rows.

Row Height, Cell Shading, and Vertical Alignment all persist into the same table-cell `style` attribute. They go through a `mergeCellStyle` helper that parses the existing `style` string into a property map, patches only the property being changed, and re-serializes it — setting one no longer silently erases the other two.

#### Custom Node Extensions (attribute-preservation pattern)

Several TipTap StarterKit default nodes don't declare a `style`/`class` attribute, so setting one via `updateAttributes(...)` or `insertContent('<tag style="...">')` is a silent no-op — the attribute never reaches the rendered DOM (and reading it back via `editor.getAttributes(...)` returns `undefined`). Wherever this editor needs an inline style or class on a StarterKit node, that node is disabled in `StarterKit.configure({...: false})` and replaced with a `.extend()`'d version that adds the attribute explicitly (mirroring `@tiptap/extension-ordered-list`'s pattern):

| Node | Custom extension | Why |
|---|---|---|
| `orderedList` | `CustomOrderedList` | `start` + `style` (numbering style, Bangla digit input rule) |
| `bulletList` | `CustomBulletList` | `style` (Disc/Circle/Square marker) |
| `horizontalRule` | `CustomHorizontalRule` | `class` + `style` (the "Page Break" `<hr>` needs its `page-break` class and dashed-line style to survive) |
| `table` | `CustomTable` | `data-border`, `data-table-style`, `data-align` |

When adding a new node-level style/attribute to this editor, check this table first — it is the recurring root cause of "I set it but nothing happened" bugs here.

#### Multi-Theme System

Thirteen themes, each a `:root`-scoped CSS class in `globals.css` defining the same set of `--primary`/`--background`/`--card`/`--border`/etc. custom properties. `ThemeProvider.tsx` wraps `next-themes` with `attribute="class"` so the selected theme id is applied as a class on `<html>`; `ThemeToggle.tsx` is the picker UI (its list is capped at `60vh` with `overflow-y-auto` so every entry stays reachable).

| Group | Theme ids |
|---|---|
| Core | `maroon` (default), `blue`, `monochrome`, `forest`, `purple`, `amber` |
| Soothing (muted single-hue) | `slate`, `sage`, `sepia` |
| Colourful (vibrant two-hue) | `teal` (teal + coral), `indigo` (indigo + gold), `emerald` (emerald + sky) |
| Dark | `dark` |

Adding a theme is three edits: the token block in `globals.css`, the `themes={[...]}` array in `ThemeProvider.tsx`, and the `THEMES` entry in `ThemeToggle.tsx`. All ribbon/editor chrome (active tab highlight, group-box borders, scrollbar thumb, callout boxes, table hover/selection) must reference `var(--primary)` (via `color-mix(in srgb, var(--primary) X%, transparent)` for translucent variants) rather than a literal color — a batch of these were previously hardcoded to `#800000`/`rgba(128,0,0,...)` and stayed maroon regardless of the active theme until fixed. The "Crimson Header" table style and a few named brand-color presets (e.g. "BUET Crimson Red" text color) are intentionally exempt, since those are meant to render a fixed brand color regardless of app theme.

#### Keyboard Shortcuts

Full list lives in `KEYBOARD_SHORTCUTS_DATA` in `RichTextEditor.tsx` and is rendered in-app via the "Shortcuts" button (or `Ctrl+/`). Beyond standard formatting shortcuts:

| Shortcut | Action |
|---|---|
| `Ctrl + Alt + T` | Open Insert Table dialog |
| `Tab` / `Shift + Tab` (in a table) | Move to next/previous cell |
| `Shift + Enter` (in a table) | Move to the same column in the next row |
| `Ctrl + Enter` | Insert a Page Break at the cursor |
| `Ctrl + Alt + P` | Toggle Word A4 Page view / Fluid Canvas |
| `Ctrl + Shift + F` | Toggle editor full-screen mode |
| `Ctrl` / `Cmd + S` | Trigger the host view's save handler (via the `onSave` prop), from anywhere in the editing panel |

---

### 5.9 PDF Preview — Interactive Layout & Inline Editing

Implementation: [`frontend/app/workspace/meetings/[id]/pdf-preview/page.tsx`](frontend/app/workspace/meetings/[id]/pdf-preview/page.tsx), [`meeting_service/utils/pdfGenerator.js`](meeting_service/utils/pdfGenerator.js), [`meeting_service/controllers/meetingController.js`](meeting_service/controllers/meetingController.js).

A full-bleed route (`/workspace/meetings/[id]/pdf-preview`, linked from the **Materials** tab) that renders the meeting's agenda / supplementary agenda / resolution / resolution-status document as a live paper preview with layout controls. `layout.tsx` and `WorkspaceLayoutWrapper.tsx` detect the `/pdf-preview` suffix and drop the meeting sidebar/chrome for this page.

- **Layout controls** — page size, orientation, per-side margins (mm), whole-document scale, and line-height — are serialised into the `GET /api/meetings/:id/pdf/:type` query string. Server-side validation/clamping and cache isolation are described in [§3.4](#34-pdf-generation--typography-engine).
- The on-screen preview mirrors the server layout via a matching `@page` rule and a CSS `zoom` on the rendered surface, so what the user sees tracks the eventual PDF.
- **Inline editing**: agenda `content`, `resolution`, meeting `description`, and `conclusion` cells are editable in place (reusing `RichTextEditor`), gated by the same `lib/meetingAccess` helpers (`canEditAgenda`, `canEditResolution`, `canEditDescription`, `canEditConclusion`, …) as the main workspace. Saves `PATCH` through the normal agenda/meeting endpoints and revalidate the SWR cache.
- `agendaNumberStyle: 'inline'` matches the preview's 3-column on-screen layout: the body opens with a bold, non-editable `<prefix-rest><serial>:` run instead of a separate "প্রস্তাব নং <n>" heading line.

---

### 5.10 Archived Agenda — Snapshot View

Implementation: [`frontend/components/meetings/ArchivedAgendaView.tsx`](frontend/components/meetings/ArchivedAgendaView.tsx), wired as the `archived-agenda` case in [`frontend/app/workspace/meetings/[id]/page.tsx`](frontend/app/workspace/meetings/[id]/page.tsx) with a sidebar entry (Archive icon) in `layout.tsx`.

A dedicated workspace view for browsing agenda snapshots that were archived off the live agenda list, with restore and delete actions inline — the same operations previously reachable only through `ArchivedAgendasModal`.

## 6. Development, Maintenance & Troubleshooting

### 6.1 Running via Docker Compose

#### Standard Mode Build & Run
```bash
# 1. Build container images
docker compose build

# 2. Build and start containers in background
docker compose up -d --build
```

#### Full Mode with AI Embeddings Build & Run
```bash
# 1. Build container images including embedding profile
docker compose --profile embeddings build

# 2. Build and start containers including embedding profile
docker compose --profile embeddings up -d --build
```

#### Container Management Commands
```bash
# View logs across all services
docker compose logs -f

# Check container health status
docker compose ps

# Rebuild single microservice
docker compose build meeting_service
docker compose up -d meeting_service

# Stop all services
docker compose down
```

---

### 6.2 Local Microservice Development Setup

1. Launch PostgreSQL, Redis, and MinIO via Docker Compose:
   ```bash
   docker compose up -d db redis minio createbuckets
   ```

2. Run `auth_service` locally:
   ```bash
   cd auth_service
   npm install
   npm run dev
   ```

3. Run `meeting_service` locally:
   ```bash
   cd meeting_service
   npm install
   npm run dev
   ```

4. Run `frontend` locally:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

---

### 6.3 Troubleshooting Guide

- **Redis Connection Errors in Embedding Worker**: Ensure Redis is running and healthcheck passes. Check `REDIS_URL` environment variable.
- **Puppeteer PDF Font Issues**: Verify that `SonarBangla.ttf` or `Kalpurush.ttf` exist in `meeting_service/utils/fonts/`.
- **MinIO Storage Presigned URL Failures**: Ensure `R3_ENDPOINT` and `R3_BUCKET_NAME` match between `.env` and `docker-compose.yml`.

---
*BUET E-Council Developer Specification — Version 2.2*
