# CLAUDE.md — BUET E-Council

Guidance for Claude Code (and future AI sessions) working in **this** repository. It
documents how the system is actually built and the rules to follow when changing it. A
companion deep-dive lives in [ARCHITECTURE.md](ARCHITECTURE.md); read it for full detail.

---

## 0. Golden Rules (read first)

1. **Preserve the existing architecture.** This is a Docker Compose microservices app
   (Nginx + Next.js frontend + two Express services + Postgres/pgvector + MinIO). Do not
   merge services, swap frameworks, introduce an ORM, or add a global state library
   unless the user explicitly asks.
2. **Make the minimal change that satisfies the request.** Touch the fewest files/lines
   possible. Do not "improve" surrounding code, reformat, or rename things while you're in
   there.
3. **Do not refactor opportunistically.** No restructuring, no extracting helpers, no
   converting callbacks/promises styles, no dependency upgrades unless that IS the task.
4. **Match the local style of the file you're editing.** Conventions here are informal and
   consistent within each service — copy the nearest existing pattern rather than importing
   an external best practice.
5. **Never modify these without being asked:** `db/init.sql` (schema/seed), `nginx/nginx.conf`,
   `docker-compose.yml`, Dockerfiles, `.github/workflows/*`, `.env`.
6. **No secrets in code or commits.** `.env` holds dev defaults; real values come from
   GitHub secrets in CI. Don't hardcode credentials or print them.
7. **Follow the response envelope and error flow** described in §7 for any new endpoint.

---

## 1. What This Project Is

A meeting-management platform for BUET's **Academic** and **Syndicate** council meetings:
users, members, invitees, attendance (presentees), agenda items, resolutions, file
annexures, reusable text templates, and Bangla PDF document generation. Much of the domain
data is **bilingual (Bangla/English)** — preserve Bangla strings and UTF-8 exactly.

---

## 2. Repository Layout

```
BUET-E-Council-2/
├── docker-compose.yml     # 7 services + 2 volumes
├── .env / .env.example    # Shared env (compose interpolation)
├── nginx/nginx.conf       # Reverse proxy, path-based routing
├── db/init.sql            # Schema, enums, seed data (runs once on first DB boot)
├── auth_service/          # Express, port 8000 — auth + user management
├── meeting_service/       # Express, port 8001 — all core domain logic
└── frontend/              # Next.js 16 App Router, port 3000
```

Ignore/never rely on scratch artifacts: `scratch.py`, `test_express.js`,
`meeting_service/test_pdf.js`, `meeting_service/controllers/scratch.js`,
`auth_service/cookies.txt`. Do not build features on top of them.

---

## 3. Tech Stack (do not substitute)

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, SWR +
  Axios, TipTap 3 (rich text), lucide-react, sonner (toasts), next-themes.
- **Backends:** Node.js + Express 5, raw `pg` driver (**no ORM**), multer (memory storage),
  bcryptjs (auth), puppeteer-core (PDF), `@aws-sdk/client-s3` (object storage), axios.
- **Infra:** PostgreSQL (`ankane/pgvector`), MinIO (S3-compatible), Nginx, Docker Compose.
- **Package manager:** npm (each service has its own `package.json` / `package-lock.json`).

When adding a dependency, add it to the specific service's `package.json` — there is no
workspace/monorepo tooling; the three Node projects are independent.

---

## 4. Services & Responsibilities

| Service           | Port | Owns                                                                 |
| ----------------- | ---- | ------------------------------------------------------------------- |
| `nginx`           | 9001 | Single public entry; routes by URL path (see §8).                    |
| `frontend`        | 3000 | Next.js UI. Talks to backends only through relative `/api` via Nginx.|
| `auth_service`    | 8000 | Signup/signin, sessions, `/me`, user CRUD, user CSV import/export. **Sole owner of the `sessions` table.** |
| `meeting_service` | 8001 | Meetings, agendas, resolutions, annexures, members, invitees, presentees, faculties, departments, offices, templates, PDFs, file uploads. |
| `db`              | —    | PostgreSQL + pgvector. Shared by both backends.                      |
| `minio`           | 9000 | Object storage for uploaded files & materials.                       |
| `createbuckets`   | —    | One-shot: creates the public bucket, then exits.                     |

**Boundary rule:** keep auth/session logic in `auth_service` and domain logic in
`meeting_service`. The meeting service must **not** query the `sessions` table directly —
it authenticates by calling the auth service (see §11).

---

## 5. Backend Architecture & Conventions (both Express services)

Each Node service follows this structure:

- `index.js` — creates the Express app, applies `cors({ origin: true, credentials: true })`,
  `express.json()`, `cookieParser()`, mounts routes, exports `app` (only calls
  `app.listen` when run directly — this keeps it testable).
- **auth_service** keeps everything in `routes.js` + `middleware.js` (flat, self-contained).
- **meeting_service** uses a **routes → controllers → db** layering:
  - `routes/<resource>Routes.js` defines endpoints and applies middleware, aggregated in
    `routes/index.js`.
  - `controllers/<resource>Controller.js` holds business logic.
  - `db.js` exposes `query(text, params)` and `pool` from a single `pg.Pool`.
  - `middlewares/`, `utils/`, `errors/` for cross-cutting concerns.

### Conventions to copy
- **Async controllers wrapped in try/catch.** On error call `next(error)` (meeting_service)
  or return a JSON 500 (auth_service) — match the file you're in.
- **Errors:** in meeting_service throw/pass `new CustomError(message, statusCode)`; the
  central `errorHandler` formats it. Never send ad-hoc error shapes there.
- **Parameterized SQL only.** Always use `$1, $2, …` placeholders — never string-concatenate
  user input into SQL. Dynamic updates are built by pushing `col = $n` fragments into an
  array (see `PUT /users/:id`, `updateMember`) — follow that exact pattern.
- **Empty-string → NULL normalization** for optional UUID/unique columns
  (e.g. `department_id`, `office_id`, `email`): `(x === "" || x === undefined) ? null : x`.
- **`COALESCE($n, col)`** is the idiom for partial updates that keep existing values.
- **Transactions** for multi-row writes: `const client = await db.pool.connect()`, then
  `BEGIN` / `COMMIT` / `ROLLBACK` in try/catch/finally with `client.release()`.
- **Unique-violation handling:** catch `error.code === '23505'` and return a 409.
- **New resource?** Add a router under `routes/`, register it in `routes/index.js`, add a
  matching controller, apply `authMiddleware` (and `checkMeetingLock` if the resource
  belongs to a meeting), and **add its `/api/<name>` prefix to `nginx/nginx.conf`** — Nginx
  only forwards prefixes it explicitly lists.

---

## 6. Frontend Architecture & Conventions

- **App Router** under `app/`. Route groups: public (`/`, `/login`, `/meetings/[id]`),
  `/admin/*` (management console, wrapped by `AdminLayoutWrapper` + `Sidebar`), `/profile/*`.
- **Client components** where interactivity/data-fetching is needed — mark with
  `"use client";` at the top (most pages are client components here).
- **Data fetching = SWR.** Read with `useSWR('/path', fetcher)`; after a write, call the
  `mutate` returned by `useSWR` to revalidate. Pass `mutate` down to child views as a prop
  (see the meeting workspace). Do **not** introduce Redux/Zustand/Context data stores.
- **The single Axios instance is `lib/api.ts`** (`baseURL = /api`, `withCredentials: true`).
  Always import it (`import api from '../lib/api'`) — never create new axios instances or
  hardcode backend hosts/ports. Cookies carry the session automatically; never manually
  attach tokens.
- **Meeting workspace pattern:** `/admin/meetings/[id]` chooses a sub-view from the `view`
  query param (`useSearchParams`), rendering components from `components/meetings/`. Add a
  new tab by adding a case there and a matching view component — keep URL-as-state.
- **Styling:** Tailwind utility classes with **semantic theme tokens** (`bg-background`,
  `text-foreground`, `bg-card`, `border-border`, `text-primary`, `bg-sidebar`, …). Use these
  tokens, not raw colors, so light/dark theming keeps working.
- **Local UI state** with `useState`; confirmations via the `useConfirm` hook; toasts via
  `sonner`.
- **Data-shape quirk to preserve:** a meeting's `title` field holds the *serial number*
  (e.g. "253") and `meeting_title` holds the display name. Don't "fix" this.

---

## 7. API Structure & Response Contract

- Auth endpoints live under `/api/auth/*`; every other resource is `/api/<resource>` on the
  meeting service.
- **Standard JSON envelope — always use it:**
  ```json
  { "success": true,  "message": "…", "data": { } }
  { "success": false, "message": "…", "error_code": "…" }
  ```
- Use conventional status codes: 200 OK, 201 created, 400 validation, 401 unauthenticated,
  403 forbidden/locked, 404 not found, 409 conflict, 500 server error.
- Meeting-service routers apply `authMiddleware`, and meeting/agenda routers additionally
  apply `checkMeetingLock`. Keep that ordering when adding routes.

---

## 8. Nginx Routing (path-based)

`nginx/nginx.conf` is the only public surface (host `9001`). Routing:

| Prefix                                                             | Upstream                       |
| ------------------------------------------------------------------ | ------------------------------ |
| `/`                                                                | `frontend:3000`                |
| `/api/auth`                                                        | `auth_service:8000`            |
| `/api/meetings`, `/api/agendas`, `/api/members`, `/api/templates`, `/api/faculties`, `/api/departments`, `/api/offices` | `meeting_service:8001` |
| `/storage/`                                                        | `minio:9000/ecouncil-bucket/`  |

**A new top-level API resource is invisible until its prefix is added here.** If you add
`/api/foo`, you must add a `location /api/foo { proxy_pass http://meeting_service:8001; }`.

---

## 9. Docker Workflow

Everything runs via Docker Compose; the root `.env` feeds Compose variable interpolation.

```bash
docker compose up -d --build --wait   # build + start all 7 services
docker compose logs -f meeting_service # tail one service
docker compose down                    # stop
docker compose down -v                 # stop AND wipe pgdata/minio (re-runs init.sql)
```

- App is reachable at **http://localhost:9001** (through Nginx). Individual services also
  expose `3000/8000/8001` for direct local debugging.
- `db` runs `db/init.sql` **only on an empty data volume** (first boot). To re-seed after a
  schema change you must `docker compose down -v` (destroys data) or migrate manually.
- `createbuckets` creates `ecouncil-bucket` and marks it public so `/storage/` links work.
- **CI/CD:** `.github/workflows` builds the compose stack, smoke-tests
  `http://localhost:9001/api/health` and `/`, then (on success, `main`) SSH-deploys to an
  Azure VM and regenerates `.env` from GitHub secrets. Don't break the health endpoints.

Frontend Dockerfile runs `npm run build` then `npm start` (production). The two Node
services just `npm install` and `npm start`.

---

## 10. Environment Variables

Defined in `.env` (template `.env.example`), injected by Compose. Key ones:

| Variable                                  | Consumer(s)                        |
| ----------------------------------------- | ---------------------------------- |
| `BACKEND_URL`                             | frontend build (public base URL)   |
| `POSTGRES_USER/PASSWORD/DB`               | db                                 |
| `DATABASE_URL`                            | auth_service, meeting_service      |
| `SECRET_KEY`                              | backends (provided as a secret)    |
| `MINIO_ROOT_USER/PASSWORD`                | minio, createbuckets               |
| `R3_REGION/ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET_NAME` | meeting_service (S3 client) |

Code fallbacks exist (`PORT`, `AUTH_SERVICE_URL` → `http://auth_service:8000`,
`NEXT_PUBLIC_API_URL` → `/api`). **Rules:** read config from `process.env` with a sensible
default; never hardcode a URL, credential, or bucket name; if you add a variable, document
it in `.env.example` (not `.env`) and, if containerized, pass it through
`docker-compose.yml`. Object-store vars are `R3_*` but the client is generic S3 (works for
MinIO locally and R2/S3 in prod) — keep that abstraction.

> The frontend also has legacy `VITE_*` build args in `docker-compose.yml` that this Next.js
> app does not consume. Leave them; do not "clean up" unrelated config.

---

## 11. Authentication Flow (session tokens, NOT JWT)

- **Sign-in:** `POST /api/auth/signin` verifies the bcrypt password, generates a random
  64-byte hex token, stores it in `sessions` (30-day expiry, device/IP/location), and sets
  an `HttpOnly`, `SameSite=strict` cookie `session_token` (Secure in production). The token
  is also returned in the body for non-browser clients.
- **auth_service authorization** (`requireAuth`): reads the token from cookie or
  `Authorization: Bearer`, joins `sessions`+`users` requiring `is_active` and unexpired,
  attaches `req.user`/`req.session`. `requireAdminOrModerator` gates admin routes.
- **meeting_service authorization** (`authMiddleware`): does **not** read the DB — it calls
  `GET {AUTH_SERVICE_URL}/api/auth/me` forwarding the cookie, and attaches the returned
  user to `req.user`. Preserve this delegation; it keeps the session store owned by
  auth_service.
- **Roles:** `admin`, `moderator`, `member`. Only **admin** may lock/unlock a meeting.
- **Frontend gating is advisory only** — `AdminLayoutWrapper` hides UI from `member`s but
  real enforcement is server-side per request. Always enforce authorization on the backend,
  never trust the client.

When adding a protected endpoint: apply the service's auth middleware; check
`req.user.role` for privileged actions; return 401 for missing/invalid auth and 403 for
insufficient role.

---

## 12. Database

- Single Postgres DB (`ecouncil_db`), pgvector-enabled. Schema, enums, and seed data live in
  `db/init.sql` (default admin user, 7 faculties, 22 departments, 27 offices).
- **No ORM, no migration tool.** Schema changes are hand-edited SQL in `init.sql` and only
  take effect on a fresh volume. If a task needs a schema change, call it out explicitly and
  prefer additive changes (new nullable column / new table) over destructive ones. Never
  silently alter existing columns or seed rows.
- **Enums are strict** (`meeting_status`, `meeting_type`, `template_type`, `annexure_type`,
  `member_type_enum`, `account_status`, …). New values require editing the `CREATE TYPE` in
  `init.sql`; don't pass enum values the schema doesn't define.
- **`agenda` table is dual-purpose:** one row stores both an agenda item (`content`,
  `embedding`) and its resolution (`resolution`, `resolution_embedding`) plus execution
  tracking. Don't split or restructure it.
- **Meeting lock is enforced in middleware** (`checkMeetingLock`), not DB constraints. Any
  new mutating route on meeting-owned data must be reachable by that middleware's
  path-resolution logic, or it won't be lock-protected.

---

## 13. File Uploads & Storage

- Uploads use **multer memory storage** (10 MB limit); buffers go straight to MinIO via
  `utils/storageService.js` (`uploadFile`/`deleteFile`/`getFileUrl`). Files never hit local
  disk.
- Keys follow patterns like `annexures/<agendaId>/<hex>.<ext>` and
  `materials/<meetingId>/<type>-<hex>.<ext>`. Keep this convention.
- Files are served back as **relative `/storage/<file_path>` links** (bucket is public,
  proxied by Nginx) — the app does not presign for reads currently. Follow that; if reads
  must become private, `getFileUrl` (presigned URLs) is the intended mechanism.
- Deleting a record that owns a file should also delete the object from storage (see
  `deleteAnnexure`).

---

## 14. PDF Generation

- `meeting_service/utils/pdfGenerator.js` renders HTML → PDF with **puppeteer-core**,
  embedding a Bangla TTF (`SonarBangla.ttf` if present, else bundled `Kalpurush.ttf`) as
  base64 so Bangla renders correctly. `GET /api/meetings/:id/pdf/:type` dispatches to
  agenda / resolution / resolution-status / attendance generators.
- `generateAgendaPdf` is currently a stub (returns an empty buffer) — leave it unless the
  task is to implement it. Keep the font-embedding approach for any Bangla output.

---

## 15. AI / Vector Search — Status

pgvector is enabled and `vector(1536)` columns exist (`agenda.embedding`,
`agenda.resolution_embedding`, `annexures.embedding`), **but no embedding generation or
similarity search is implemented** — no LLM/embedding client, no `<=>` queries. Template
"search" is a plain SQL `ILIKE`. Treat semantic search as a **not-yet-built** feature: do
not assume it works, and only build it if explicitly asked (then wire an embedding provider
and cosine queries against the existing columns rather than adding new ones).

---

## 16. Checklist Before Finishing a Change

- [ ] Change is minimal and scoped to the request; no drive-by refactors or reformatting.
- [ ] Followed the local patterns of the edited service (error handling, SQL style,
      response envelope).
- [ ] Parameterized SQL; no injected user input.
- [ ] Backend authorization enforced (not just frontend gating).
- [ ] New API resource → router registered, middleware applied, **Nginx prefix added**.
- [ ] New env var → added to `.env.example` and `docker-compose.yml` (not `.env`).
- [ ] No secrets committed; Bangla/UTF-8 text preserved.
- [ ] Did not modify `init.sql`, `nginx.conf`, `docker-compose.yml`, Dockerfiles, or
      workflows unless that was the task.
- [ ] Health endpoints (`/api/health`, `/`) still respond so CI passes.
```
