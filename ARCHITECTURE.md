# BUET E-Council — Architecture Documentation

The BUET E-Council system is a meeting-management platform for Bangladesh University
of Engineering and Technology (BUET). It digitizes the workflow of **Academic** and
**Syndicate** council meetings: managing members, invitees, attendance, agenda items,
resolutions, annexures (attachments), reusable text templates, and the generation of
official Bangla PDF documents (agenda sheets, resolution sheets, attendance sheets).

This document describes the system as it currently exists in the codebase. It does not
change any behaviour; it is a map for engineers joining the project.

---

## 1. High-Level Architecture

The project is a **containerized microservices application** orchestrated by Docker
Compose and fronted by a single Nginx reverse proxy. There are two backend services, a
Next.js frontend, a PostgreSQL (pgvector) database, and a MinIO object store.

```
                          ┌──────────────────────────────────────────┐
                          │            Nginx (port 9001→80)           │
                          │              reverse proxy                │
                          └──────────────────────────────────────────┘
             /                    /api/auth          /api/meetings, /api/agendas,
             │                        │               /api/members, /api/faculties,
             │                        │               /api/departments, /api/offices,
             ▼                        ▼               /api/templates       │   /storage/
    ┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐ │  ┌──────────┐
    │  frontend        │     │  auth_service    │     │ meeting_service  │ └─▶│  MinIO   │
    │  Next.js 16      │     │  Express (8000)  │◀────│  Express (8001)  │───▶│  (S3 API)│
    │  (port 3000)     │     │                  │  verify │              │   └──────────┘
    └─────────────────┘     └──────────────────┘  token  └──────────────┘
                                     │                          │
                                     └───────────┬──────────────┘
                                                 ▼
                                     ┌──────────────────────────┐
                                     │  PostgreSQL + pgvector    │
                                     │  (db, port 5432 internal) │
                                     └──────────────────────────┘
```

Key architectural properties:

- **Single public entry point.** Only Nginx (host port `9001`) is meant to be public.
  The frontend and both backends also bind host ports (`3000`, `8000`, `8001`) for local
  development, but in production traffic flows through Nginx.
- **Path-based service routing.** Nginx routes `/api/auth` to the auth service and all
  other `/api/*` resource paths to the meeting service. Everything else goes to the
  Next.js frontend. `/storage/` is proxied straight to the MinIO bucket.
- **Stateless auth verification between services.** The meeting service does not read the
  session table directly; it calls the auth service's `/api/auth/me` to validate a token
  on every request (see [Authentication Flow](#5-authentication-flow)).
- **Shared database.** Both backend services connect to the same PostgreSQL instance via
  `DATABASE_URL`. There is no per-service database isolation.

---

## 2. Tech Stack

| Layer            | Technology                                                            |
| ---------------- | --------------------------------------------------------------------- |
| Frontend         | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4        |
| Rich text        | TipTap 3 (with tables, text-align, font-family, underline, link)      |
| Data fetching    | SWR + Axios                                                           |
| UI/UX            | lucide-react icons, sonner (toasts), next-themes (dark/light)         |
| Auth service     | Node.js 23, Express 5, bcryptjs, cookie-parser, Swagger (jsdoc + UI)  |
| Meeting service  | Node.js (23 image), Express 5, pg, multer, puppeteer-core, AWS SDK v3 |
| Database         | PostgreSQL via `ankane/pgvector` image (UUID + `vector` extensions)   |
| Object storage   | MinIO (S3-compatible), accessed with `@aws-sdk/client-s3`             |
| PDF generation   | puppeteer-core (headless Chromium) rendering HTML → PDF with Bangla fonts |
| CSV import/export| csv-parser, json2csv                                                  |
| Reverse proxy    | Nginx (alpine)                                                        |
| Orchestration    | Docker Compose                                                        |
| CI/CD            | GitHub Actions (build+smoke test → SSH deploy to Azure VM)            |

Note the intended abstraction: the object-store env vars are named `R3_*` (Cloudflare R2)
but the storage client is generic S3, so the same code targets MinIO locally and R2/S3 in
production by only changing endpoint/credentials.

---

## 3. Repository / Folder Structure

```
BUET-E-Council-2/
├── docker-compose.yml         # Orchestrates all 7 services
├── .env / .env.example        # Shared environment variables
├── nginx/
│   └── nginx.conf             # Reverse proxy + path routing
├── db/
│   └── init.sql               # Schema, enums, seed data (runs on first DB boot)
│
├── auth_service/              # Authentication & user management (Express, port 8000)
│   ├── index.js               # App entry, mounts /api/auth + Swagger at /api-docs
│   ├── routes.js              # All auth endpoints (signup, signin, sessions, users, CSV)
│   ├── middleware.js          # requireAuth (reads session table), requireAdminOrModerator
│   ├── db.js                  # pg Pool
│   ├── utils.js               # device-info extraction from headers
│   └── swagger.js             # OpenAPI spec config
│
├── meeting_service/           # Core domain service (Express, port 8001)
│   ├── index.js               # App entry, mounts /api, global error handler
│   ├── routes/                # One router per resource, aggregated in routes/index.js
│   ├── controllers/           # Business logic per resource
│   ├── middlewares/
│   │   ├── authMiddleware.js   # Verifies token via auth_service /me
│   │   ├── lockMiddleware.js   # Blocks mutations on locked meetings
│   │   └── errorHandler.js     # Central error responder
│   ├── utils/
│   │   ├── storageService.js   # S3/MinIO upload/delete/presign
│   │   ├── fileManager.js      # multer memory-storage config (10 MB limit)
│   │   ├── pdfGenerator.js     # Puppeteer HTML→PDF (agenda/resolution/attendance)
│   │   └── fonts/              # Bangla TTF fonts (Kalpurush, optionally SonarBangla)
│   └── errors/CustomError.js   # Error class with statusCode
│
└── frontend/                  # Next.js App Router UI (port 3000)
    ├── app/                   # Routes (public home, login, admin/*, profile/*, meetings/*)
    ├── components/            # Shared + meeting-workspace view components
    ├── lib/api.ts             # Axios instance (baseURL /api, withCredentials)
    ├── hooks/useConfirm.tsx   # Confirmation-dialog hook
    └── ...                    # next.config.ts, tailwind/postcss, tsconfig
```

Root-level `scratch.py`, `test_express.js`, `meeting_service/test_pdf.js`,
`controllers/scratch.js`, and `auth_service/cookies.txt` are development scratch/test
artifacts, not part of the running system.

---

## 4. Frontend ↔ Backend Communication

- The frontend uses a single Axios instance ([frontend/lib/api.ts](frontend/lib/api.ts))
  with `baseURL = process.env.NEXT_PUBLIC_API_URL || '/api'` and `withCredentials: true`.
  In the deployed setup the baseURL is the **relative** `/api`, so all browser calls hit
  Nginx on the same origin, which then fans out to the correct backend by path.
- **Cookies carry the session.** Because `withCredentials` is on and the session cookie is
  `HttpOnly`, the browser attaches it automatically to every `/api/*` request; the
  frontend never manually handles the token.
- **Reads** use SWR (`useSWR('/meetings', fetcher)` etc.), giving caching, revalidation,
  and a `mutate` function to refresh after writes. **Writes** use `api.post/put/delete`
  directly, typically followed by `mutate()` to re-sync.
- The docker-compose build args `VITE_API_BASE_URL` / `VITE_API_INTERNAL_URL` are legacy
  Vite-style names and are **not** consumed by this Next.js app (which reads
  `NEXT_PUBLIC_API_URL`); the effective default is `/api` through Nginx.

Example write-then-revalidate pattern lives throughout the meeting workspace views
([frontend/app/admin/meetings/[id]/page.tsx](frontend/app/admin/meetings/[id]/page.tsx)),
which pass SWR's `mutate` into child view components.

---

## 5. Authentication Flow

Authentication is **opaque-token session based** (not JWT). Tokens are random 64-byte hex
strings stored server-side in the `sessions` table.

### Sign-in (auth_service, [routes.js](auth_service/routes.js))
1. `POST /api/auth/signin` with `username`/`email` + `password`.
2. Service looks up the user, checks `status = 'active'`, and verifies the password with
   `bcrypt.compare`.
3. On success it generates `crypto.randomBytes(64)` as the session token, inserts a row
   into `sessions` (with device info, IP, sign-in location, 30-day expiry).
4. It sets an `HttpOnly`, `SameSite=strict` cookie `session_token` (Secure in production)
   **and** returns the token in the JSON body (so non-browser clients can use a Bearer
   header).

### Request authorization — two different mechanisms
- **auth_service** uses `requireAuth` ([middleware.js](auth_service/middleware.js)): it
  reads the token from the cookie or `Authorization: Bearer`, then joins `sessions` +
  `users` in one SQL query, requiring `is_active = TRUE AND expires_at > NOW()`. It
  attaches `req.user` and `req.session`. `requireAdminOrModerator` gates admin endpoints.
- **meeting_service** uses `authMiddleware`
  ([middlewares/authMiddleware.js](meeting_service/middlewares/authMiddleware.js)): it does
  **not** touch the session table. It extracts the token and makes an HTTP call to
  `GET {AUTH_SERVICE_URL}/api/auth/me` (forwarding the cookie). If the auth service
  confirms the session, it attaches the returned user object to `req.user`. This keeps the
  session store owned solely by the auth service.

### Session lifecycle endpoints
- `POST /signout` — deactivates the current session (`is_active = FALSE`) and clears cookie.
- `POST /signout-all` — deactivates all of the user's sessions.
- `GET /sessions` / `DELETE /sessions/:id` — list active sessions and remotely terminate a
  specific one (the current session must be ended via `/signout`, not this endpoint).
- `GET /me` — returns the current user's profile; also the verification endpoint the
  meeting service depends on.

### Frontend gating
- Login page ([app/login/page.tsx](frontend/app/login/page.tsx)) just posts credentials and
  redirects; the cookie handles the rest.
- Admin routes are guarded client-side by
  [AdminLayoutWrapper](frontend/components/AdminLayoutWrapper.tsx): it SWR-fetches
  `/auth/me`; if the role is `member` it redirects to `/`. (This is a UX guard — real
  enforcement is server-side per request.)

### Roles
`user_role` enum: `admin`, `moderator`, `member`. Admins/moderators manage users and data;
only **admins** may lock/unlock a meeting.

---

## 6. Database Layer

A single PostgreSQL database (`ecouncil_db`) initialized by
[db/init.sql](db/init.sql) on first container start. It enables the `uuid-ossp` and
`vector` (pgvector) extensions and defines a rich set of enums.

### Access pattern
Both services use the raw `pg` driver via a shared `Pool` (`db.js` in each service). There
is **no ORM**; queries are hand-written parameterized SQL. Multi-row imports use explicit
`BEGIN`/`COMMIT`/`ROLLBACK` transactions on a checked-out client (e.g. CSV user import,
external member sync).

### Core tables

| Table         | Purpose                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `users`       | Accounts (username, email, bcrypt password, role, member_type, status).       |
| `sessions`    | Server-side sessions (token, device_info, ip, location, expiry, is_active).    |
| `faculties`   | BUET faculties (bilingual names, serial). Seeded.                             |
| `departments` | Departments/institutes with aliases, optional `faculty_id`. Seeded (22 rows).  |
| `offices`     | Named offices/posts (Dean, Dept Head, VC, etc.), bilingual. Seeded (27 rows).  |
| `members`     | People who can attend meetings; linked to a department or office.             |
| `meetings`    | A council meeting: title/serial, type, date, status, lock flag, PDF links.    |
| `agenda`      | Agenda items **and** their resolutions (both text + `vector(1536)` embeddings).|
| `invitees`    | Per-meeting invitees (name, designation, dept/office, `is_present`).           |
| `presentees`  | Per-meeting attendance records used for the attendance sheet.                  |
| `templates`   | Reusable text snippets (typed, public/private, usage count).                   |
| `revisions`   | Version history of agenda/resolution text edits.                              |
| `annexures`   | File attachments for an agenda item/resolution (path, summary, `vector` embed).|

### Notable enums
`meeting_type` (syndicate/academic), `meeting_status` (draft/ongoing/past/locked),
`member_type_enum` (academic/syndicate/none), `template_type` (agendaItem, resolutionItem,
agendam, resolution, description, conclusion), `annexure_type` (agendaItem/resolution),
`account_status` (active/inactive), plus several boolean-like enums.

### Seed data
`init.sql` inserts a default **admin** user (`admin` / `admin@buet.ac.bd`, password is a
pre-hashed bcrypt value), all 7 faculties, 22 departments, and 27 offices — so the system
is usable immediately after first boot.

The `agenda` table's semantics are important: one row holds an agenda item *and* its
corresponding resolution (`content`/`embedding` for the agenda text,
`resolution`/`resolution_embedding` for the outcome), plus execution tracking
(`is_executed`, `execution_status`) and flags like `is_suppli` for supplementary agenda.

---

## 7. Docker Setup

[docker-compose.yml](docker-compose.yml) defines **7 services** and 2 named volumes.

| Service         | Image / Build                | Host Ports        | Notes                                    |
| --------------- | ---------------------------- | ----------------- | ---------------------------------------- |
| `db`            | `ankane/pgvector:latest`     | (internal only)   | Runs `init.sql`, healthcheck via pg_isready. `pgdata` volume. |
| `auth_service`  | build `./auth_service`       | `8000:8000`       | Node 23 alpine. Depends on `db`.         |
| `meeting_service`| build `./meeting_service`   | `8001:8001`       | Depends on `db` + `minio`.               |
| `frontend`      | build `./frontend`           | `3000:3000`       | Next.js production build (`npm run build` → `npm start`). |
| `nginx`         | `nginx:alpine`               | `9001:80`         | Mounts `nginx.conf`. Depends on all above. `restart: always`. |
| `minio`         | `minio/minio`                | `9000` API, `9090` console | Healthcheck on `/minio/health/live`. `minio_data` volume. |
| `createbuckets` | `minio/mc`                   | —                 | One-shot: creates the bucket and sets it public, then exits. |

Dockerfiles are straightforward `node` base images that `npm install`, copy source, and
run `npm start` (frontend additionally runs `npm run build` first). Environment values come
from the root `.env` via Compose variable interpolation.

The `createbuckets` sidecar is the mechanism that makes `/storage/` links work: it creates
`ecouncil-bucket` and marks it anonymously readable so Nginx can proxy files without
signing.

---

## 8. Nginx Routing

[nginx/nginx.conf](nginx/nginx.conf) is a single `server` block on port 80 that forwards
`Host` / `X-Real-IP` / `X-Forwarded-*` headers and routes by path prefix:

| Location prefix     | Upstream                              |
| ------------------- | ------------------------------------- |
| `/`                 | `frontend:3000` (catch-all, the UI)   |
| `/api/auth`         | `auth_service:8000`                   |
| `/api/meetings`     | `meeting_service:8001`                |
| `/api/faculties`    | `meeting_service:8001`                |
| `/api/departments`  | `meeting_service:8001`                |
| `/api/offices`      | `meeting_service:8001`                |
| `/api/members`      | `meeting_service:8001`                |
| `/api/templates`    | `meeting_service:8001`                |
| `/api/agendas`      | `meeting_service:8001`                |
| `/storage/`         | `minio:9000/ecouncil-bucket/`         |

So the *only* thing distinguishing which backend serves a request is the URL path — the
auth service owns exactly one prefix, the meeting service owns the rest of the resource
prefixes, and file downloads bypass the backends entirely by hitting the public MinIO
bucket directly.

---

## 9. API Structure

Both services follow a consistent JSON envelope:
`{ success: boolean, message?: string, data?: ..., error_code?: string }`.

### auth_service — `/api/auth/*` ([routes.js](auth_service/routes.js))
Public: `POST /signup`, `POST /signin`.
Authenticated: `POST /signout`, `POST /signout-all`, `GET /sessions`,
`DELETE /sessions/:id`, `GET /me`, `PUT /me`, `GET /secure-test`.
Admin/moderator only: `GET /users`, `PUT /users/:id`, `POST /upload-csv` (bulk user import),
`GET /download-csv` (user export). Swagger docs are served at `/api-docs`.

### meeting_service — `/api/*` (routers in [routes/](meeting_service/routes/))
Every router applies `authMiddleware`; meeting/agenda routers additionally apply
`checkMeetingLock`.

- **`/api/meetings`** — CRUD; plus `bulk-import`, `:id/complete`, `:id/lock` (admin),
  invitees sub-resource (add/list/update/remove/`bulk-fetch`), presentees sub-resource,
  `:id/attendance`, `GET :id/pdf/:type` (agenda | resolution | resolution-status |
  attendance), and `POST :id/materials/upload`.
- **`/api/agendas`** — agenda-item CRUD; nested resolutions
  (`:id/resolutions`, `resolutions/:resId`, `resolutions/:resId/execution`); annexures
  (list, upload with file, `annexures/reorder`, delete).
- **`/api/members`** — CRUD plus `POST /fetch-external` (sync from BUET registrar API).
- **`/api/faculties`, `/api/departments`, `/api/offices`** — CRUD plus `PUT /reorder`,
  `POST /upload-csv`, `GET /download-csv`.
- **`/api/templates`** — CRUD plus `GET /search`, `PATCH /:id/visibility`,
  `POST /:id/use` (increment usage counter).

### Cross-cutting middleware
- **Meeting lock** ([lockMiddleware.js](meeting_service/middlewares/lockMiddleware.js)):
  for any mutating request it resolves the owning `meeting_id` (directly from the route,
  or by looking up the agenda/annexure), and if that meeting's `is_locked` is true it
  rejects with 403. GET requests and the `/lock` toggle itself are exempt. This is what
  freezes a finalized meeting's record.
- **Central error handling** ([errorHandler.js](meeting_service/middlewares/errorHandler.js))
  turns thrown `CustomError`s into the standard JSON envelope; stack traces are only
  included when `NODE_ENV=development`.

### External integration
`POST /api/members/fetch-external` pulls faculty/staff data from two BUET registrar PHP
endpoints (`regoffice.buet.ac.bd/.../users.php` and `.../Dean_Head.php`), maps English
designations to Bangla, resolves departments/offices (creating office rows on demand), and
upserts `members` inside a transaction.

---

## 10. State Management (Frontend)

There is **no global state library** (no Redux/Zustand/Context store for data). State is:

- **Server state via SWR.** Each page/component fetches with `useSWR(key, fetcher)` where
  `fetcher` is the shared Axios getter. SWR's cache is the de-facto app state; after a
  mutation, components call `mutate()` (returned from `useSWR`) to revalidate. `mutate` is
  threaded down into child view components as a prop.
- **Local UI state via `useState`.** Tabs, form fields, dialog visibility, editor content,
  etc. (e.g. the home page toggles `academic`/`syndicate` with `useState`).
- **URL as state.** The meeting workspace uses `useSearchParams().get('view')` to decide
  which sub-view to render, so the active workspace tab is encoded in the URL query string.
- **Theme** is handled by `next-themes` via a `ThemeProvider` wrapper, with a
  `ThemeToggle` component.
- **Confirmations** use a custom `useConfirm` hook returning a promise-based dialog.

---

## 11. Component Organization (Frontend)

Next.js **App Router** with route groups:

- **Public**: `/` (home, meeting list with academic/syndicate tabs) and `/login`.
- **`/admin/*`**: the management console, wrapped by `admin/layout.tsx` →
  `Header` + `AdminLayoutWrapper`. Pages: `meetings`, `templates`, `members`, `faculties`,
  `departments`, `offices`, `users`, plus an admin dashboard. Navigation is a `Sidebar`
  (`type="admin"`) with a fixed link list.
- **`/admin/meetings/[id]`**: a special "meeting workspace" that
  [AdminLayoutWrapper](frontend/components/AdminLayoutWrapper.tsx) detects by regex and
  renders full-width (its own sidebar/tabs instead of the standard admin sidebar). The
  page ([[id]/page.tsx](frontend/app/admin/meetings/[id]/page.tsx)) switches on the `view`
  query param to render one of the meeting view components.
- **`/profile/*`**: user profile and session management, using `Sidebar type="profile"`.
- **`/meetings/[id]`**: a public/read view of a meeting.

Component layers under `components/`:
- **Shared primitives**: `DataTable`, `CustomSelect`, `SearchableSelect`, `RichTextEditor`
  (TipTap), `Header`, `Sidebar`, `UserDropdown`, `ThemeProvider`/`ThemeToggle`,
  `TemplateDrawer`, `MeetingTable`.
- **Meeting workspace views** (`components/meetings/`): `MeetingInfoView`, `InviteesView`,
  `AgendaView`, `ResolutionView`, `DescriptionView`, `MaterialsView`, `AnnexureList`,
  `TakeAttendanceView`, `JsonImportDialog`. These map 1:1 to workspace tabs and receive
  `meeting` + `mutate` props.

---

## 12. Environment Variables

Defined in root [.env](.env) (template in [.env.example](.env.example)) and injected via
Docker Compose. On the Azure VM the CD workflow regenerates `.env` from GitHub
secrets/variables.

| Variable                | Used by                    | Purpose                                            |
| ----------------------- | -------------------------- | -------------------------------------------------- |
| `BACKEND_URL`           | compose (frontend build)   | Public base URL (e.g. `http://localhost:9001`).    |
| `POSTGRES_USER/PASSWORD/DB` | db                     | Postgres bootstrap credentials.                    |
| `DATABASE_URL`          | auth_service, meeting_service | Postgres connection string.                     |
| `SECRET_KEY`            | both backends              | Provided as a secret (session tokens are actually random bytes, not signed). |
| `MINIO_ROOT_USER/PASSWORD` | minio, createbuckets    | MinIO admin credentials.                           |
| `R3_REGION`             | meeting_service            | S3 region (`us-east-1` for MinIO, `auto` for R2).  |
| `R3_ENDPOINT`           | meeting_service            | S3 endpoint (`http://minio:9000` locally).         |
| `R3_ACCESS_KEY_ID` / `R3_SECRET_ACCESS_KEY` | meeting_service | S3 credentials.                          |
| `R3_BUCKET_NAME`        | meeting_service, nginx, createbuckets | Bucket name (`ecouncil-bucket`).        |

Service-level fallbacks also exist in code: `PORT` (8000/8001), `AUTH_SERVICE_URL`
(defaults to `http://auth_service:8000`), `NODE_ENV`, and frontend `NEXT_PUBLIC_API_URL`
(defaults to `/api`).

> ⚠️ The committed `.env` contains development-default credentials. These must be replaced
> with real secrets in any non-local deployment.

---

## 13. File Upload Flow

Uploads exist in three places, all using **multer memory storage** (buffers in RAM, 10 MB
limit) and then pushing to object storage — files never touch a local disk.

1. **Annexures** (`POST /api/agendas/:id/annexures`,
   [agendaController.js](meeting_service/controllers/agendaController.js)):
   multer parses the multipart file → a unique key `annexures/<agendaId>/<randomhex>.<ext>`
   is generated → `storageService.uploadFile` puts it in MinIO → an `annexures` row is
   inserted with the file path, name, summary, and next serial. Deleting an annexure also
   deletes the object from storage.
2. **Meeting materials** (`POST /api/meetings/:id/materials/upload`,
   [meetingController.js](meeting_service/controllers/meetingController.js)):
   uploads a pre-made PDF for `agenda` / `resolution` / `resolution-status`, keyed under
   `materials/<meetingId>/...`, and stores the key in the corresponding
   `*_pdf_link` column on the meeting.
3. **CSV imports** (users in auth_service; faculties/departments/offices in meeting_service):
   the CSV buffer is streamed through `csv-parser` and rows are inserted in a transaction.
   CSV **exports** use `json2csv` to stream rows back as an attachment.

**Serving files back:** the storage service *can* generate presigned URLs
(`getFileUrl`), but the app instead relies on the bucket being **public** and returns
relative links of the form `/storage/<file_path>`
([agendaController.js](meeting_service/controllers/agendaController.js)). Nginx proxies
`/storage/` to `minio:9000/ecouncil-bucket/`, so the browser fetches attachments directly
without hitting the Node backend or signing a URL. The `createbuckets` sidecar is what
makes the bucket anonymously readable.

`storageService` ([utils/storageService.js](meeting_service/utils/storageService.js)) wraps
the AWS SDK v3 S3 client with `forcePathStyle: true` (required by MinIO) and exposes
`uploadFile`, `deleteFile`, and `getFileUrl`.

---

## 14. PDF Generation

Official documents are generated server-side by
[utils/pdfGenerator.js](meeting_service/utils/pdfGenerator.js) using **puppeteer-core**
(headless Chromium) to render HTML into PDF, with a Bangla TTF font embedded as base64
(`SonarBangla.ttf` if present, else the bundled `Kalpurush.ttf`) so Bangla text renders
correctly.

`GET /api/meetings/:id/pdf/:type` dispatches to:
- `generateAgendaPdf` — agenda sheet (currently a stub returning an empty buffer),
- `generateResolutionPdf(id[, includeStatus])` — resolution sheet, optionally with
  execution status; pulls the meeting, its presentees (grouped by admins/deans/heads/
  departments/others), and its agenda rows ordered by serial,
- `generateAttendanceSheet` — attendance document.

The buffer is streamed back with `Content-Type: application/pdf`. Separately, materials
uploaded via the upload endpoint let staff attach externally-produced PDFs instead of
generating them.

---

## 15. AI / Vector Search

The database is **provisioned for semantic/vector search but it is not yet wired up in
application code.**

- The pgvector extension is enabled and three columns are `vector(1536)`-typed
  (OpenAI embedding dimension): `agenda.embedding`, `agenda.resolution_embedding`, and
  `annexures.embedding`. The dimension and comments in [db/init.sql](db/init.sql) indicate
  the intent to embed agenda text, resolutions, and annexure summaries.
- However, **no code currently generates embeddings** (no OpenAI/embedding client, no
  vector-write) and **no similarity query is performed** (no `<=>` / cosine operators
  anywhere). The `resolution_embedding` column is only ever read into a SELECT list or set
  to `NULL` on delete.
- Template "search" (`GET /api/templates/search`) is a plain SQL `ILIKE '%q%'` substring
  match ([templateController.js](meeting_service/controllers/templateController.js)) — not
  semantic.

In short: the schema is future-proofed for a retrieval/semantic-search feature (likely
"find related past agenda items / resolutions"), but that capability is a planned extension
rather than a shipped feature. The CD workflow's commented-out `GROQ_API_KEY` placeholder
hints at an intended LLM integration.

---

## 16. CI/CD

Two GitHub Actions workflows (`.github/workflows/`):

1. **CI Pipeline** (on push/PR to `main`): `docker compose build`, `docker compose up -d
   --wait`, then smoke tests — `curl` the health endpoint through Nginx
   (`http://localhost:9001/api/health`) and the frontend root — dumping logs on failure and
   tearing down afterward.
2. **Deploy to Azure VM** (triggered only when CI succeeds on `main`): SCPs the repo to the
   VM, regenerates `.env` from GitHub secrets/variables, then `docker compose pull` /
   `down` / `up -d --build --wait` and prunes old images.

---

## 17. Notable Cross-Cutting Behaviours & Gotchas

- **Meeting `title` holds the serial number.** The frontend home page treats `m.title` as a
  serial (e.g. "253") and `m.meeting_title` as the display name — worth knowing when
  reading meeting records.
- **Two auth models coexist.** The auth service checks sessions against the DB directly;
  the meeting service delegates to the auth service over HTTP. A meeting-service request
  therefore incurs an internal round-trip to `auth_service` per call.
- **Locking is enforced by middleware, not DB constraints.** `checkMeetingLock` must
  correctly resolve the owning meeting for every mutating route; new mutating routes need
  to fit its path-parsing logic or they won't be lock-protected.
- **Public storage bucket.** Attachments are world-readable via `/storage/`. Presigned URLs
  are implemented but unused; if the bucket is ever made private, `getFileUrl` is the
  intended path.
- **Vector columns are dormant** — see §15.
- **Frontend route protection is advisory** — `AdminLayoutWrapper` only hides UI; backends
  enforce real authorization.
```
