# BUET E-Council — Electronic Council & Meeting Management System

[![Architecture: Microservices](https://img.shields.io/badge/Architecture-Microservices-blue.svg)](#system-architecture)
[![Database: PostgreSQL + pgvector](https://img.shields.io/badge/Database-PostgreSQL_%2B_pgvector-blue.svg)](#technology-stack)
[![Frontend: Next.js 15](https://img.shields.io/badge/Frontend-Next.js_15-black.svg)](#technology-stack)
[![Search: 3--Tier Hybrid Search](https://img.shields.io/badge/Search-3--Tier_Hybrid_Search-green.svg)](#7-multi-tier-hybrid-search-details)
[![License: Proprietary](https://img.shields.io/badge/License-BUET-red.svg)](#)

**BUET E-Council** is an enterprise-grade, secure, web-based Electronic Council & Meeting Management System designed for **Bangladesh University of Engineering and Technology (BUET)**. It streamlines the lifecycle of Syndicate and Academic Council meetings, agenda preparation, resolution tracking, level-based multi-tier approval workflows, attendance taking, annexure attachments, PDF document generation with native Bangla font rendering, and AI-powered multi-tier hybrid vector search.

---

## Table of Contents

- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Microservices Overview](#microservices-overview)
- [Quick Start & Installation Guide](#quick-start--installation-guide)
  - [Prerequisites](#prerequisites)
  - [Step 1: Clone Repository](#step-1-clone-repository)
  - [Step 2: Environment Configuration](#step-2-environment-configuration)
  - [Step 3: Build & Run via Docker Compose](#step-3-build--run-via-docker-compose)
  - [Step 4: Accessing the Application](#step-4-accessing-the-application)
  - [Useful Docker Compose Management Commands](#useful-docker-compose-management-commands)
  - [Default Credentials](#default-credentials)
- [System User Guide](#system-user-guide)
  - [1. User Roles & Hierarchical Role Levels](#1-user-roles--hierarchical-role-levels)
  - [2. Comprehensive Handover & Locking Logic](#2-comprehensive-handover--locking-logic)
    - [Lock Types Reference Table](#lock-types-reference-table)
    - [Handover Features & Workflow Stages](#handover-features--workflow-stages)
    - [Send-Back (Reject & Return) Feature](#send-back-reject--return-feature)
  - [3. Meeting Lifecycle & Workflows](#3-meeting-lifecycle--workflows)
  - [4. Attendance & Invitee Management](#4-attendance--invitee-management)
  - [5. PDF Material Export](#5-pdf-material-export)
  - [6. JSON Bulk Meeting Import](#6-json-bulk-meeting-import)
  - [7. Multi-Tier Hybrid Search Details](#7-multi-tier-hybrid-search-details)
    - [How Keyword Search Works (Tier 0)](#how-keyword-search-works-tier-0)
    - [How Entity Search Works (Tier 1)](#how-entity-search-works-tier-1)
    - [How Vector Semantic Search Works (Tier 2)](#how-vector-semantic-search-works-tier-2)
- [Frontend Navigation & Workspace Routes](#frontend-navigation--workspace-routes)
- [Port & Route Mapping](#port--route-mapping)
- [Environment Variables Reference](#environment-variables-reference)
- [Developer & Maintenance Guide](#developer--maintenance-guide)

---

## Key Features

### 🏢 Council & Organizational Structure
- **University Structure Support**: Comprehensive modeling of Faculties, Departments, Offices, and Academic/Syndicate Council Members.
- **Dynamic Seniority Ordering**: Automatic ordering of members and invitees based on official university serial numbers.

### 📋 Complete Meeting Management
- **Meeting Types**: Native support for **Syndicate** and **Academic** Council meetings.
- **Lifecycle Progression**: `Draft` → `Ongoing` → `Past` (Completed) status lifecycle.
- **Agenda & Resolution Authoring**: Rich-text editing (TipTap) for agenda bodies, supplementary agendas (`is_suppli`), and resolutions.
- **Execution Tracking**: Track execution status and execution history for individual resolution items.
- **Version Control & Revisions**: Complete audit trail of all content edits with full revision comparison.
- **Archived Agenda Snapshots**: Archive agenda items off the live list and browse, restore, or delete the snapshots from a dedicated workspace view.

### 🔒 Hierarchical Level-Based Handover & Locking
- **Level-Based RBAC**: Dynamic integer level roles enabling hierarchical editor chains (e.g., Level 1 Initiator → Level 2 Reviewer → Level 3 Finalizer).
- **Handover Delegation**: Transfer editing authority forward to higher levels while restricting access to completed lower levels.
- **Granular Section Locking**: 8 specialized section locks controlling Meeting Info, Agenda, Supplementary Agenda, Resolution, Resolution Status, Invitees, Presentees, and Conclusion.
- **Send-Back Capability**: Superior role levels can return items back to lower levels for revision.

### 🔍 3-Tier Hybrid Search System
- **Tier 0: Exact Keyword Search**: Full-text search using Postgres `tsvector` with `simple` dictionary (preserving both English and Bangla tokens without language stemmer corruption).
- **Tier 1: Fast Entity Search**: Trigram matching (`gin_trgm_ops`) on pre-extracted departments, offices, faculties, members, and custom agenda entities.
- **Tier 2: Vector Semantic Search**: Dense vector similarity search powered by `pgvector` (HNSW cosine distance) and `BAAI/bge-m3` multi-lingual embeddings (1024 dimensions).
- **Smart Cascading & Caching**: Early exit optimization if higher tiers satisfy query limits, backed by SHA-256 hash-keyed search cache automatically invalidated via Postgres database triggers.

### 📄 PDF Document Export & Bangla Typography
- **Puppeteer PDF Engine**: High-performance headless browser PDF generation with connection pooling.
- **Embedded Bangla Fonts**: Built-in Base64 embedding of `SonarBangla.ttf` and `Kalpurush.ttf` ensuring consistent, pixel-perfect Bangla rendering without external font dependency.
- **Export Formats**: PDF downloads for Agenda Documents, Official Resolutions, and Resolution Execution Status reports.
- **Interactive PDF Preview**: A live preview page with page size / orientation / margin / scale / line-height controls (validated and clamped server-side, cached per-layout) plus in-place cell editing of agenda, resolution, description, and conclusion text.
- **Markdown Tables**: Pipe-style Markdown tables in agenda/resolution bodies are converted to bordered HTML tables in the rendered document, tolerant of entity-encoded pipes and autocorrected dash separators.

---

### 🎨 Theming
- **13 application themes** applied as a class on `<html>` via `next-themes` — 6 core (Maroon default, Ocean Blue, Monochrome, Forest, Purple, Amber), 3 soothing (Slate, Sage, Sepia), 3 colourful two-hue (Teal Horizon, Indigo Scholar, Emerald Meadow), and Midnight Dark.
- All chrome (ribbon, scrollbars, tables, callouts) is driven by CSS custom properties, so a theme switch recolours the whole app instantly.

---

## System Architecture

```
                                  +-----------------------+
                                  |     Client Browser    |
                                  +-----------+-----------+
                                              |
                                              v (Port 9001)
                                  +-----------+-----------+
                                  |     NGINX Gateway     |
                                  +-----+-----+-----+-----+
                                        |     |     |
              +-------------------------+     |     +-------------------------+
              |                               |                               |
              v (/api/auth)                   v (/api/*)                      v (/storage/*)
     +--------+-------+             +---------+-------+             +---------+-------+
     |  auth_service  |             | meeting_service |             |      MinIO      |
     |   (Node.js)    |             |   (Node.js)     |             |  (S3 Storage)   |
     +--------+-------+             +----+----+-------+             +-----------------+
              |                          |    |
              |                          |    +-------------------+
              v                          v                        v
     +--------+--------------------------+--------+      +--------+-------+
     |             PostgreSQL + pgvector          |      |     Redis 7    |
     |          (Transactional & Vector DB)       |      |   (BullMQ)     |
     +--------------------------------------------+      +--------+-------+
                                                                  |
                                                                  v
                                                         +--------+-------+
                                                         | embedding_     |
                                                         | worker (Node)  |
                                                         +--------+-------+
                                                                  |
                                                                  v
                                                         +--------+-------+
                                                         | embedding_     |
                                                         | service (Py)   |
                                                         +----------------+
```

---

## Technology Stack

| Layer | Technology | Description |
|---|---|---|
| **Reverse Proxy & Gateway** | NGINX Alpine | Route dispatching, SSL, authenticated file proxying, payload limits |
| **Frontend Framework** | Next.js 15 (App Router) | React 19, TypeScript, Tailwind CSS, SWR, TipTap Editor |
| **Authentication Service** | Node.js / Express | Session management, password hashing (bcrypt), CSV import, email |
| **Meeting Service** | Node.js / Express | Core domain logic, level workflow engine, PDF generation (Puppeteer) |
| **Background Queue** | Redis 7 & BullMQ | Asynchronous search index processing and resource-throttled queueing |
| **Embedding Service** | Python 3.11 / FastAPI | Sentence-Transformers (`BAAI/bge-m3`), PyTorch, 1024-dim vectors |
| **Database** | PostgreSQL 16 | `pgvector` (HNSW indexing), `pg_trgm`, `uuid-ossp`, stored triggers |
| **Object Storage** | MinIO (S3 compatible) | Annexure storage, signature uploads, authenticated stream proxying |

---

## Quick Start & Installation Guide

### Prerequisites

- **Docker** (v24.0+)
- **Docker Compose** (v2.20+)
- Minimum **4 GB RAM** (8 GB recommended if running full AI embeddings)

---

### Step 1: Clone Repository

```bash
git clone https://github.com/BUET/buet-ecouncil.git
cd buet-ecouncil
```

---

### Step 2: Environment Configuration

Copy the sample environment configuration:

```bash
cp .env.example .env
```

Verify/update sensitive variables in `.env` as needed:

```env
POSTGRES_USER=admin
POSTGRES_PASSWORD=buet_admin_pass
POSTGRES_DB=ecouncil_db
DATABASE_URL=postgresql://admin:buet_admin_pass@db:5432/ecouncil_db

SECRET_KEY=your_random_super_secret_key
ALLOWED_ORIGINS=http://localhost:9001

MINIO_ROOT_USER=minio_admin
MINIO_ROOT_PASSWORD=secure_minio_password
R3_BUCKET_NAME=ecouncil-bucket
```

---

### Step 3: Build & Run via Docker Compose

#### Option A: Standard Build & Run (Recommended for standard deployment)
Builds and starts all core services (Frontend, Auth Service, Meeting Service, NGINX Gateway, PostgreSQL + pgvector, Redis, MinIO):

```bash
# 1. Build container images
docker compose build

# 2. Build and start containers in detached mode
docker compose up -d --build
```

#### Option B: Full AI Embeddings Build & Run (Includes Vector Semantic Search)
Builds and starts core services plus the Python `embedding_service` (FastAPI `BAAI/bge-m3`) and Node.js `embedding_worker` (BullMQ):

```bash
# 1. Build all container images including embedding profile
docker compose --profile embeddings build

# 2. Build and start all containers including embedding profile
docker compose --profile embeddings up -d --build
```

---

### Step 4: Accessing the Application

Once containers complete startup and healthchecks pass, access the web application in your browser:

👉 **`http://localhost:9001`**

---

### Useful Docker Compose Management Commands

```bash
# View live logs across all services
docker compose logs -f

# View live logs for a specific service
docker compose logs -f meeting_service auth_service

# Check health and status of running containers
docker compose ps

# Rebuild a single microservice (e.g. after code changes)
docker compose build meeting_service
docker compose up -d meeting_service

# Stop all running containers
docker compose down

# Stop containers and remove volume data (Fresh reset)
docker compose down -v
```

---

### Default Credentials

Upon fresh database initialization (`db/init.sql`), two default administrative accounts are created:

| Username | Default Password | Role | Access Level |
|---|---|---|---|
| `admin` | `123456` | `admin` | Full Administrative Privileges |

---

## System User Guide

### 1. User Roles & Hierarchical Role Levels

The system implements a dual-layer permission framework:

1. **System Roles**:
   - `admin` / `superadmin`: Override role with full access across all meetings, settings, users, and actions.
   - `editor`: Granular editor user whose editing rights depend on their assigned **Role Level** (integer level).
   - `viewer`: Read-only access to completed meetings (filtered by `member_type`: Academic vs Syndicate).
   - `moderator` / `file_initiator`: Specialized roles for initiation and moderation.

2. **Hierarchical Role Levels** (e.g., Level 1, Level 2, Level 3):
   - Dynamic numerical levels configured in User Management (`/workspace/users`).
   - Numerical ordering defines workflow hierarchy: **Higher numerical levels have superior authority over lower numerical levels** (e.g., Level 3 > Level 2 > Level 1).

---

### 2. Comprehensive Handover & Locking Logic

The core workflow mechanism is governed by two complementary controls: **Handover Levels** ($L_{handover}$) and **Lock Levels** ($L_{locked}$).

```
[Level 1 Editor] ----(Handover to L2)----> [Level 2 Reviewer] ----(Handover to L3)----> [Level 3 Approval]
 (L1 loses edit access)                     (L2 edits, can Send Back to L1)               (L3 finalizes)
```

#### Lock Types Reference Table

The system features **8 distinct section locks** on each meeting record:

| Lock Name | Database Field | What It Controls | Who Can Edit When Locked at Level $L$? |
|---|---|---|---|
| **Meeting Lock** | `meeting_locked_level` | Meeting title, date, type, president, description | Users with Level $\ge L$ or Admin |
| **Agenda Lock** | `agenda_locked_level` | Main agenda items (create, edit, delete, reorder) & annexures | Users with Level $\ge L$ or Admin |
| **Suppli Agenda Lock** | `suppli_agenda_locked_level` | Supplementary agenda items (`is_suppli = true`) | Users with Level $\ge L$ or Admin |
| **Resolution Lock** | `resolution_locked_level` | Resolution text for agenda items | Users with Level $\ge L$ or Admin |
| **Resolution Status Lock** | `resolution_status_locked_level` | Execution status (`is_executed`, `execution_status`) | Users with Level $\ge L$ or Admin |
| **Invitees Lock** | `invitees_locked_level` | Invitee list, adding non-members, & invitee reordering | Users with Level $\ge L$ or Admin |
| **Presentees Lock** | `presentees_locked_level` | Attendance taking & presentee status during meeting | Users with Level $\ge L$ or Admin |
| **Conclusion Lock** | `conclusion_locked_level` | Meeting conclusion notes & wrap-up text | Users with Level $\ge L$ or Admin |

---

#### Handover Features & Workflow Stages

Handover is designed for **stage-by-stage document progression** along an institutional hierarchy. There are 4 distinct handover fields:

1. `agenda_handover_level` (Main Agendas Handover)
2. `suppli_agenda_handover_level` (Supplementary Agendas Handover)
3. `resolution_handover_level` (Resolutions Handover)
4. `resolution_status_handover_level` (Resolution Execution Tracking Handover)

##### How Handover Works Step-by-Step:
1. **Initiation (Level 1)**: A Level 1 user drafts the agendas or resolutions.
2. **Handover Action**: When finished, Level 1 clicks **"Send to Level 2"**.
   - `agenda_handover_level` is set to `1`.
   - **Access Change**: All users at Level $\le 1$ immediately **lose edit access** (read-only mode).
   - **Reviewer Access**: Users at Level $> 1$ (e.g., Level 2, Level 3, Admin) **gain review and edit access**.
3. **Subsequent Handover**: Level 2 reviews, modifies, and clicks **"Send to Level 3"**.
   - `agenda_handover_level` becomes `2`. Level 2 users now lose edit access; Level 3 gains access.

---

#### Send-Back (Reject & Return) Feature

If a reviewer at a higher level (e.g., Level 2 or Level 3) finds errors or requires changes in a handed-over section:

- **Who can Send Back?**: Any user with Role Level $> L_{handover}$ (or `admin`).
- **Send-Back Action**: Clicking **"Send Back"** resets or decrements the handover level back to a lower level (e.g., from Level 2 back to Level 1, or resetting to `NULL`).
- **Effect**: Full editing rights are **instantly restored to lower-level authors** (Level 1), enabling them to revise their draft before handing it forward again.

---

### 3. Meeting Lifecycle & Workflows

A council meeting progresses through three primary lifecycle states:
1. **Draft**: Newly created meeting. Agendas and supplementary agendas are authored and organized.
2. **Ongoing**: Meeting in session. Attendance is taken; resolutions are authored and finalized.
3. **Past (Completed)**: Finalized meeting. Content is locked and indexed for full system search.

---

### 4. Attendance & Invitee Management

- **Invitees**: Official members and custom invitees listed for a meeting.
- **Automatic Seniority Syncing**: Updating a member's global university serial automatically reorders their pending invitee entry across meetings via trigger `trg_sync_invitee_serial`.
- **Attendance Taker**: During ongoing meetings, operators mark presentees with a single click and capture designated attendance status.

---

### 5. PDF Material Export

Export official formatted council documents with custom page headers, footers, page numbers, and native Bangla typography:
- **Agenda Book**: Complete agenda booklet for meeting participants.
- **Resolution Document**: Official council decisions and approved resolutions.
- **Resolution Status Report**: Execution status report tracking implementation progress across university departments.
- **PDF Preview**: Open any of the above from the **Materials** tab in an interactive preview (`/workspace/meetings/[id]/pdf-preview`) to adjust page size, orientation, margins, scale, and line-height before downloading or printing, and to edit agenda/resolution/description/conclusion text in place.

---

### 6. JSON Bulk Meeting Import

Historical meeting archives can be imported in bulk using structured JSON files (see sample [`meeting_import_format.json`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/meeting_import_format.json)):
- Dynamic entity resolution maps departmental raw text to canonical university entities using ordering rules defined in [`MERGE_RULES.md`](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/MERGE_RULES.md).

---

### 7. Multi-Tier Hybrid Search Details

BUET E-Council features an advanced **3-Tier Hybrid Search Engine** designed to handle complex multilingual queries (Bangla & English):

```
+--------------------------------------------------------------------+
|                       User Search Query                            |
+--------------------------------------------------------------------+
                                  |
                                  v
+--------------------------------------------------------------------+
| Tier 0: Full-Text Keyword Search (Postgres tsvector 'simple')      |
| -> Matches exact Bangla & English terms with ts_rank scoring       |
+--------------------------------------------------------------------+
                                  | (If < 30 results)
                                  v
+--------------------------------------------------------------------+
| Tier 1: Entity Trigram Search (gin_trgm_ops)                       |
| -> Matches departments, offices, faculties, members, & entities    |
+--------------------------------------------------------------------+
                                  | (If < 30 results & embeddings active)
                                  v
+--------------------------------------------------------------------+
| Tier 2: Vector Semantic Search (pgvector HNSW + bge-m3 model)      |
| -> Dense vector similarity search for conceptual matches          |
+--------------------------------------------------------------------+
```

#### How Keyword Search Works (Tier 0)
- **Plain Text Indexing**: HTML content is stripped to create plain-text mirrors (`content_plain` and `resolution_plain`).
- **PostgreSQL Generated `tsvector`**: PostgreSQL automatically maintains `content_tsv` and `resolution_tsv` vector columns.
- **Why the `'simple'` Text Dictionary?**: Standard English stemmers corrupt Bangla words by stripping suffixes. The `'simple'` dictionary tokenizes whitespace and punctuation literally without stemming, preserving both Bangla script and English words accurately.
- **Query Parsing & Ranking**: Uses `websearch_to_tsquery('simple', q)` supporting phrases (`"..."`), OR logic, and exclusion (`-`). Ranks results with `ts_rank()` and wraps matched terms in HTML `<mark>` tags via `ts_headline()`.
- **Cascading Early Exit**: If Tier 0 yields $\ge 30$ matches, search stops immediately, saving compute.

#### How Entity Search Works (Tier 1)
- **Problem Solved**: Addresses cases where agenda items mention official entity names, abbreviations, or aliases (e.g. "CSE", "সিএসই", "কম্পিউটার সায়েন্স এন্ড ইঞ্জিনিয়ারিং", "Department Head, EEE", "Vice Chancellor") that might not match exact query keywords verbatim.
- **Entity Extraction**: Scans 6 entity reference sources (`departments`, `offices`, `members`, `faculties`, `invitees`, and pre-indexed `agenda_entities`).
- **Trigram Matching (`gin_trgm_ops`)**: Uses PostgreSQL `pg_trgm` indexes to perform fast trigram substring matching against canonical entity names and aliases. Agendas linked to matching entities are returned as Tier 1 entity matches.

#### How Vector Semantic Search Works (Tier 2)
- **Problem Solved**: Finds conceptually relevant agendas even when written with completely different vocabulary or phrasing (e.g., query "শিক্ষকদের পদোন্নতি সংক্রান্ত নীতিমালা" matching an agenda titled "আবেদন বিবেচনা ও পদোন্নতি প্রক্রিয়া").
- **Text Chunking**: Long bodies are chunked into smaller text blocks.
- **`BAAI/bge-m3` Embedding Model**: Generates 1024-dimensional normalized float vectors via the Python `embedding_service`. `bge-m3` is a state-of-the-art multilingual model supporting over 100 languages including Bangla.
- **HNSW Vector Cosine Distance (`pgvector`)**: Computes cosine distance `(c.embedding <=> $1::vector)` accelerated by **HNSW graph indexes** (`idx_agenda_chunks_hnsw`). Returns the most conceptually similar chunks.

---

## Frontend Navigation & Workspace Routes

> 📌 **NOTE**: There are **no `/admin/*` routes** in the frontend. All administrative, management, and workspace features are organized under the unified `/workspace/*` route hierarchy:

| Frontend Route | Feature & Purpose | Authorized Roles |
|---|---|---|
| `/workspace/meetings` | Meeting management dashboard (list, create, edit, import) | Admin / Editor / Viewer |
| `/workspace/users` | User accounts, account status toggles, & Role Level management | Admin / Upper Editors |
| `/workspace/members` | Council members registry & seniority ordering | Admin / Editor |
| `/workspace/departments` | University department catalog & alias mapping | Admin / Editor |
| `/workspace/offices` | University offices registry | Admin / Editor |
| `/workspace/faculties` | University faculty catalog | Admin / Editor |
| `/workspace/templates` | Agenda & Resolution template library | Admin / Editor |
| `/workspace/audit-log` | System-wide audit log viewer | Admin / Upper Editors |
| `/meetings/[id]` | Interactive meeting management tab container | Admin / Editor / Viewer |
| `/workspace/meetings/[id]?view=…` | Meeting workspace views: `info`, `permissions`, `invitees`, `agenda`, `suppli-agenda`, `archived-agenda`, `resolution`, `conclusion`, `materials`, `email`, `signed-persona`, `history` | Admin / Editor / Viewer |
| `/workspace/meetings/[id]/pdf-preview` | Full-bleed interactive PDF preview with layout controls & inline editing | Admin / Editor |
| `/search` | Dedicated 3-Tier Hybrid Search portal | All authenticated users |
| `/viewer` | Read-only viewer portal for academic/syndicate members | Viewer / All users |
| `/profile` | User profile, password change, and active session manager | All authenticated users |

---

## Port & Route Mapping

All external traffic enters through the NGINX reverse proxy on host port **`9001`**:

| Host Path | Upstream Target | Purpose |
|---|---|---|
| `/` | `frontend:3000` | Next.js Web Interface |
| `/api/auth/*` | `auth_service:8000` | User Authentication & Account Management |
| `/api/meetings/*` | `meeting_service:8001` | Meetings, Agendas & Resolutions |
| `/api/faculties/*` | `meeting_service:8001` | University Faculty Registry |
| `/api/departments/*` | `meeting_service:8001` | Department Registry & Aliases |
| `/api/offices/*` | `meeting_service:8001` | Office Registry |
| `/api/members/*` | `meeting_service:8001` | University Members Registry |
| `/api/templates/*` | `meeting_service:8001` | Agenda & Resolution Templates |
| `/api/agendas/*` | `meeting_service:8001` | Agenda & Resolution Operations |
| `/api/tags/*` | `meeting_service:8001` | System Tag Catalog |
| `/api/search/*` | `meeting_service:8001` | 3-Tier Search Orchestration |
| `/api/audit-logs/*` | `meeting_service:8001` | System Audit Trails |
| `/storage/*` | `meeting_service:8001` | Rewritten by NGINX to `/api/storage/*` & gated via `authMiddleware` |

---

## Environment Variables Reference

| Variable | Default Value | Description |
|---|---|---|
| `POSTGRES_USER` | `admin` | Database superuser username |
| `POSTGRES_PASSWORD` | `buet_admin_pass` | Database superuser password |
| `POSTGRES_DB` | `ecouncil_db` | PostgreSQL database name |
| `DATABASE_URL` | `postgres://...` | Connection URI for microservices |
| `SECRET_KEY` | - | Session encryption key |
| `ALLOWED_ORIGINS` | `http://localhost:9001` | CORS allowed origins |
| `MINIO_ROOT_USER` | `minioadmin` | MinIO administrative username |
| `MINIO_ROOT_PASSWORD` | `minioadmin` | MinIO administrative password |
| `R3_BUCKET_NAME` | `ecouncil-bucket` | S3 bucket name for attachments |
| `MAX_ANNEXURE_SIZE_MB` | `20` | Maximum single annexure upload size (MB) |
| `SMTP_HOST` | - | Outgoing SMTP mail server host |
| `SMTP_PORT` | `587` | Outgoing SMTP mail server port |
| `MAIL_FROM` | `no-reply@buet.ac.bd` | System email sender address |
| `MODEL_NAME` | `BAAI/bge-m3` | Hugging Face embedding model name |

---

## Developer & Maintenance Guide

For technical architecture, database schemas, workflow permission state matrices, search engine implementation details, and step-by-step developer guides, refer to the companion developer documentation:

📄 **[Read Developer Guide (`documentation.md`)](file:///media/samyo-pramanik/New%20Volume2/buet-ecouncil2/documentation.md)**

---

*Built with ❤️ for Bangladesh University of Engineering and Technology (BUET).*
