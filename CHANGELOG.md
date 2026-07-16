# Changelog

## 2026-07-16 — Session Summary

A large batch of features, security fixes, and infrastructure hardening across `frontend`, `meeting_service`, `auth_service`, `nginx`, and `db`.

---

### New Features

**Audit log ("who did what")**
- New `audit_logs` table (`db/init.sql`), written by both services (they share one database):
  - `meeting_service/middlewares/auditMiddleware.js` — generic logger mounted on `meetingRoutes.js` and `agendaRoutes.js`; records every mutating (POST/PUT/DELETE) request with user, action, entity type/id, IP.
  - `auth_service/auditLog.js` — explicit logging on signup, signin (success **and** failed attempts), signout, signout-all, user updates, CSV bulk import, and self profile updates.
- Admin-only API: `GET /api/audit-logs` (`meeting_service/controllers/auditLogController.js`, `routes/auditLogRoutes.js`) with filters for **username, action, entity type, and date range**, paginated.
- Admin-only page: `frontend/app/admin/audit-log/page.tsx` — filterable table, linked from the sidebar (admin-only, both frontend nav gating and backend `requireRole('admin')`).
- **Weekly archives**: `meeting_service/utils/auditArchiver.js` exports each completed ISO week's logs to `audit-log-archives/<YYYY-Www>.json` in object storage; idempotent (skips weeks already archived, skips empty weeks). Listed/downloadable from the audit-log page via `GET /api/audit-logs/archives`.
  - Runs inside `meeting_service/index.js`'s own always-on process — **not** the optional `embedding_worker` (an earlier bug had it coupled there, silently disabling it whenever the `embeddings` Compose profile was off; fixed since audit logging has nothing to do with embeddings).

**Bulk JSON meeting import**
- `frontend/components/meetings/JsonImportDialog.tsx` rewritten to accept **multiple files at once** (previously: paste-only, then single-file-upload-only).
- Each file is parsed and checked independently against existing departments/offices; mapping or creating a department/office **propagates across every file in the batch** that references the same name, so you resolve each one once, not per-file.
- Per-file status tracking (Needs attention → Ready → Importing → Imported/Failed) with a final summary; partial failures don't block the rest of the batch.

**Viewer role gets a real read-only area**
- New routes `frontend/app/viewer/meetings/page.tsx` and `.../[id]/page.tsx` (thin re-exports of the existing public, already-read-only `/` and `/meetings/[id]` pages — no duplicated logic).
- `AdminLayoutWrapper.tsx` redirects `role === 'viewer'` to `/viewer/meetings` instead of letting them into `/admin/*` with hidden buttons.
- Login now redirects **by role** instead of always to `/`: viewers land on `/viewer/meetings`, admins/moderators land on `/admin/meetings` (`app/login/page.tsx`, reading `role` straight from the signin response).
- "Dashboard" link in `UserDropdown.tsx` is role-aware to match.

**`/admin/meetings` gained Academic/Syndicate tabs**
- Same tabbed filtering as the public `/` dashboard, added to the existing admin meetings management table (`app/admin/meetings/page.tsx`) rather than a new/duplicate page — so the Add/Edit/Delete/JSON-import tooling admins and moderators already use is unchanged, it's just tab-filterable now.

**Collapsible presentee list**
- `frontend/app/meetings/[id]/page.tsx` — "উপস্থিত সদস্যবৃন্দ" (present members) is now collapsed by default with a chevron toggle, instead of always rendering.

**Collapsible left navigation + non-blocking overlay**
- Left sidebar (`components/Sidebar.tsx`, the meeting-workspace step nav, and `profile/layout.tsx`) is **hidden by default at every screen size**, toggled by a persistent hamburger button (`components/SidebarToggleButton.tsx`).
- The toggle button uses `position: fixed` (anchored to the viewport, not any particular scrolling element) so it never scrolls away regardless of what actually scrolls on the page, and sits above the sidebar's `z-50`, sliding to just past its edge when open — earlier versions had it trapped underneath the opened sidebar and unclickable.
- Opening the sidebar **no longer shows a dimming backdrop that blocks the rest of the page** — it overlays with a drop shadow, but everything beside/behind it stays fully clickable and scrollable.
- The toggle button (and the top `Header.tsx`) both dim to near-transparent once the page is scrolled, restoring full opacity on hover.
- Fixed a real bug found along the way: `Sidebar.tsx`'s active-link check used `pathname.startsWith(href + '/')`, which made "Profile" (`/profile`) light up as active on **any** `/profile/*` route, including `/profile/sessions`. Now prefers an exact match among the sidebar's own links before falling back to prefix-matching.

**Search box relocation and scoping**
- Moved out of the main navbar row into its own row directly underneath it, within the same sticky/dimming header block (`components/Header.tsx`).
- Hidden entirely on pages where it doesn't apply: `/admin/members`, `/admin/faculties`, `/admin/users`, `/admin/departments`, `/admin/offices`, `/admin/audit-log`, and `/profile*`. Still shown on `/`, `/admin/meetings`, meeting detail pages, and the viewer area.

---

### Security Fixes

**Public file storage was completely unauthenticated**
- `nginx/nginx.conf` used to proxy `/storage/` straight to MinIO — anyone with a file's URL (materials, annexures) could fetch it, no login required.
- Added an authenticated streaming route: `meeting_service/routes/storageRoutes.js` + `controllers/storageController.js` (gated by the existing `authMiddleware`), and repointed nginx at that instead of MinIO directly. MinIO's bucket ACL also set back to private (`docker-compose.yml`'s `createbuckets` step).

**Annexure uploads: unrestricted type/size**
- `meeting_service/config/annexureUpload.js` — single place defining an allowed-extension whitelist (currently PDF/DOCX, easy to add/remove) with matching MIME-type cross-check, and a configurable size cap (`MAX_ANNEXURE_SIZE_MB` env var). Wired into `agendaRoutes.js`'s multer config.
- Raised nginx's `client_max_body_size` (was the real, silent 1MB default bottleneck) and mapped `MulterError` to a clean 400 in `errorHandler.js` instead of a generic 500.

**Delete permissions were too broad**
- Whole-meeting delete is now **admin-only** (`meetingRoutes.js`, `MeetingInfoView.tsx`, admin meetings list).
- Agenda/resolution/annexure delete remain **admin + moderator** (unchanged from original behavior, confirmed intentional).

---

### Bug Fixes

- **Search triggered on every keystroke** instead of on Enter (`frontend/app/search/page.tsx`) — typing now only updates local state; the URL (and the actual search request) updates on submit. Tag/date/scope filters remain reactive.
- **Draft meetings were publicly visible** on the home dashboard (`frontend/app/page.tsx`) — now filtered out alongside the existing type filter.
- **Admin password seed didn't match documentation**: the bcrypt hash in `db/init.sql` didn't correspond to the password the README claimed (`buet_admin_pass`), so a fresh install's documented login would silently fail. Regenerated the hash to actually match; also updated to the project's current default (`123456`) per later request.
- **nginx cached upstream container IPs at startup** and never re-resolved — after any upstream (e.g. `frontend`) restarted with a new Docker-assigned IP, nginx kept hammering the dead old IP (502s) until nginx itself was restarted. Fixed with `resolver 127.0.0.11 valid=10s;` (Docker's embedded DNS) plus `set $upstream ...; proxy_pass $upstream;` in every location block, so nginx re-resolves per request.

---

### Infrastructure / DevOps

- **`embedding_service` / `embedding_worker` are now optional** (`docker-compose.yml`, Compose `profiles: ["embeddings"]`). `meeting_service` no longer hard-depends on `embedding_service` being healthy to start — every code path that calls it (`searchController.js`, `searchIndexer.js`) already degrades gracefully to keyword-only search if it's unreachable.
  - Lightweight (no ML model, much less CPU/RAM): `docker compose up -d`
  - Full stack with semantic search: `docker compose --profile embeddings up -d`
- **Database schema drift fix**: this environment's DB volume predated the search feature — missing `tags`, `agenda_chunks`, `resolution_chunks`, `search_cache` tables and `agenda.content_plain`/`resolution_plain`/`*_tsv` columns. Applied the missing DDL to bring it in line with `db/init.sql`; the existing self-healing background indexer (`utils/backgroundIndexer.js`) backfills old rows automatically once the schema exists — no manual data migration needed.
- Added `audit_logs` table + indexes to `db/init.sql` for fresh installs.

---

### Files Changed (non-exhaustive, by area)

**Frontend**: `app/page.tsx`, `app/login/page.tsx`, `app/search/page.tsx`, `app/meetings/[id]/page.tsx`, `app/admin/meetings/page.tsx`, `app/admin/audit-log/page.tsx` (new), `app/viewer/meetings/page.tsx` (new), `app/viewer/meetings/[id]/page.tsx` (new), `app/admin/meetings/[id]/layout.tsx`, `app/profile/layout.tsx`, `components/Header.tsx`, `components/Sidebar.tsx`, `components/SidebarToggleButton.tsx` (new), `components/AdminLayoutWrapper.tsx`, `components/UserDropdown.tsx`, `components/meetings/JsonImportDialog.tsx`, `components/meetings/MeetingInfoView.tsx`, `components/meetings/AgendaView.tsx`, `components/meetings/AnnexureList.tsx`.

**meeting_service**: `routes/storageRoutes.js` (new), `routes/auditLogRoutes.js` (new), `routes/meetingRoutes.js`, `routes/agendaRoutes.js`, `controllers/storageController.js` (new), `controllers/auditLogController.js` (new), `middlewares/auditMiddleware.js` (new), `middlewares/errorHandler.js`, `config/annexureUpload.js` (new), `utils/storageService.js`, `utils/auditArchiver.js` (new), `index.js`, `worker.js`.

**auth_service**: `auditLog.js` (new), `routes.js`.

**Infra**: `nginx/nginx.conf`, `docker-compose.yml`, `db/init.sql`, `.env.example`.
