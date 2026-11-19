# MediaEX

The media cloud for creators and studios: a Next.js 16 (App Router) landing page with a Three.js hero, sign-in, and a
workspace dashboard, with a separate Node.js API. Accounts, workspaces and teams are real (Better Auth + Postgres), and
so is the media core: uploads, an FFmpeg pipeline that encodes video and audio to adaptive HLS, a library, playback and
share/embed links. Analytics, API keys, webhooks and billing in the dashboard are still generated sample data
(`lib/sample.ts`) and are labelled so.

## Run it locally

You need Node 22, a Postgres database and FFmpeg (`ffmpeg` and `ffprobe` on your PATH — only the API service uses them).
The quickest way to get Postgres is Docker:

```bash
docker run -d --name mediaex-postgres --restart unless-stopped \
  -e POSTGRES_USER=mediaex -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=mediaex \
  -p 127.0.0.1:54340:5432 -v mediaex-pgdata:/var/lib/postgresql/data postgres:17-alpine
```

Then:

```bash
cp .env.example .env.local   # fill in DATABASE_URL and BETTER_AUTH_SECRET
npm ci
npm run dev:backend          # terminal 1: migrates Postgres and starts the API (and media worker) on port 3401
npm run dev                  # terminal 2: frontend at http://localhost:3400
```

Create an account at `/sign-up`. Without `RESEND_API_KEY`, emails (verification, password reset, invitations) are not
sent; they appear at **http://localhost:3400/dev/mailbox** instead (development only — that page is a 404 in production).
Locally, media is stored under `./.media`.

## Deploying on Hoist

Connect two web services to the same repository and branch. Use the repository root for the frontend and `backend` for the API.

| Service | Build command | Start command | Settings |
|---|---|---|---|
| Frontend | `npm run build` | `npm start` | Port 3400. Set `BACKEND_URL` to the backend HTTPS origin and `MEDIAEX_API_TOKEN` to the shared server-side secret. |
| Backend | Leave blank | Leave blank | Set the root directory to `backend`, the port to 3401 and the health check to `/readyz`. Hoist uses the backend Dockerfile. Set the backend variables below. |

Set the same random `MEDIAEX_API_TOKEN` of at least 32 characters on both services. Keep it independent of the session signing secret. The backend image type-checks the API during the build and contains its locked production dependencies at runtime. Startup runs the auth and media table migrations. Use `/healthz` for process health.

The API image ships Node.js, the PostgreSQL-backed account service and the media API, plus FFmpeg (`ffmpeg` and `ffprobe`) for the media pipeline. Add new API dependencies to `backend/package.json` and its lockfile, put runtime files under `backend/`, and install any required system binaries in the Dockerfile's runtime stage. Include new database migrations in the backend startup migration.

| Backend variable | Purpose |
|---|---|
| `DATABASE_URL` | Renviq Postgres connection string with TLS and permission to manage the auth and media tables |
| `BETTER_AUTH_SECRET` | Session signing secret. Generate 32 random bytes and keep the value across releases. |
| `BETTER_AUTH_URL` | Public HTTPS **frontend** origin, e.g. `https://mediaex.example.com`. This is the origin for cookies, callbacks and emailed links. |
| `RESEND_API_KEY`, `MAIL_FROM` | Optional production email delivery. With a Resend API key, new accounts must verify their email. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google sign-in |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional GitHub sign-in |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | **Durable media storage** in an S3-compatible bucket (Cloudflare R2, AWS S3, MinIO). Required for uploads in production unless `MEDIA_DIR` points at a mounted volume. |
| `MEDIA_DIR` | Local-disk storage directory. Only durable if it is a persistent volume. |
| `MAX_UPLOAD_BYTES` | Largest upload accepted (default 5 GiB) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Only if FFmpeg isn't on the PATH |
| `MEDIA_WORKER` | `off` runs an API-only instance that doesn't encode |
| `MAX_VARIANTS_PER_ASSET` | Cached transformation variants kept per asset (default 200) |
| `ANTHROPIC_API_KEY` | Optional. Lets workspaces turn on automatic image review in moderation (Claude looks at images and video frames) |

Generate each secret separately with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Store production values in service secrets. Register OAuth callbacks at `<BETTER_AUTH_URL>/api/auth/callback/google` or `<BETTER_AUTH_URL>/api/auth/callback/github`.

Without `RESEND_API_KEY` in production, password-reset and invitation emails are skipped (a warning is logged), so set
it before inviting real users.

Container filesystems are wiped on every redeploy, so in production the backend **refuses uploads** (HTTP 503 with an
explanation) until a bucket or a mounted `MEDIA_DIR` is configured; everything else keeps working. Browsers upload
straight to the bucket with presigned URLs, so the bucket needs a CORS rule allowing `PUT` from the frontend origin.
The backend logs which storage it uses at startup.

## How auth works

- `backend/auth.mts` — Better Auth config: email + password, sessions in Postgres (30 days), password reset, email
  verification, and the organization plugin, which provides **workspaces** (owner / admin / member), members and
  invitations. Every new account gets a personal workspace, unless it signed up to accept an invitation.
- `app/api/auth/[...all]/route.ts` — forwards same-origin browser auth requests to `backend/server.mts`.
- `proxy.ts` — fast redirect to `/sign-in` for `/dashboard/*` when there's no session cookie.
- `backend/account.mts` — validates the session and loads the user’s workspaces and membership role for the dashboard. Better Auth enforces workspace permissions on the backend.
- `backend/migrate.mts` — creates or updates the tables (`npm run db:migrate`).

## How media works

The frontend only renders and forwards; everything that touches files or the database runs in the backend.

1. **Upload.** The dashboard asks `POST /api/uploads` for a slot; the backend creates the asset (status `uploading`) and
   returns where to `PUT` the file: a presigned bucket URL, or (local disk) `/api/uploads/:id`, which streams through
   the frontend to the backend. `POST /api/uploads/:id/complete` checks the size and queues the asset.
2. **Pipeline.** `backend/media/worker.mts` runs inside the backend process. It claims queued assets from Postgres
   (`for update skip locked`, so several instances can share the queue) and runs FFmpeg:
   - *Analyse*: ffprobe for type, codec, size, duration; a thumbnail frame (or a waveform for audio).
   - *Encode*: video → H.264/AAC HLS ladder at 1080p, 720p, 480p, 360p (never above the source); audio → AAC HLS;
     images → a 2560 px poster.
   - *Package*: master playlist, sizes, and publishing to the bucket.
   Progress is written to the asset row; the dashboard polls `/api/assets` while anything is in flight.
   Jobs interrupted by a restart are picked up again after two minutes, up to three attempts.
3. **Playback.** `/api/media/:id/…` serves playlists, thumbnails and posters to anyone with the link (asset IDs are
   random), so share links (`/embed/:id`) and iframes work; with a bucket, playlists list signed segment URLs
   (valid 6 hours) that players fetch straight from the bucket. The original is a members-only download.

The frontend forwards `/api/assets`, `/api/uploads` and `/api/media` to the backend unchanged (`proxyMedia` in
`lib/backend.ts`), streaming in both directions.

### Organising and finding media

- **Folders** nest; an asset lives in at most one. Deleting a folder moves its assets and subfolders up a level, so
  nothing is lost. **Collections** group assets from any folder (an asset can be in several). **Tags** are lowercase
  with dashes, up to 20 per asset.
- **Search** (`GET /api/assets?q=&folder=&collection=&type=&status=&tags=&date=&sort=`) matches every word against
  titles, file names, source info and tags (partial words count), then narrows by the filters. The Library keeps the
  same parameters in its URL, so any view can be bookmarked or shared, and **saved searches** store them per person.
- **Bulk actions** (`POST /api/assets/bulk`): move, tag, untag and delete up to 500 assets at once. In the Library,
  select with the checkboxes (Shift for a range), or drag cards onto a folder or collection.
- Endpoints live in `backend/media/library.mts`: `/api/folders`, `/api/collections`, `/api/tags`, `/api/searches`.

### Transformations

`GET /api/media/:id/transform` returns a resized, cropped or re-encoded image of an asset: the image itself, a frame of
a video (`t=` seconds), or an audio asset's waveform. The first request renders it (sharp; FFmpeg pulls video frames
straight from storage) and stores it under the asset's `derived/` folder; later requests are served from storage.

| Parameter | Values |
|---|---|
| `w`, `h` | 1–4096 px. One side scales; both sides fill the box (`fit=cover`) |
| `dpr` | 1–3, multiplies `w`/`h` for sharp screens |
| `fit` | `cover` (default with both sides), `contain`, `inside` (default with one side), `outside`, `fill` |
| `pos` | `center`, `top`, `bottom`, `left`, `right`, `attention` (smart: what stands out), `entropy` (smart: most detail) |
| `f` | `auto` (default: AVIF or WebP when the browser accepts them), `avif`, `webp`, `jpeg`, `png` |
| `q` | 1–100 quality (default 80) |
| `t` | video only: the frame time in seconds |
| `blur`, `gray`, `rot`, `flip` | blur 1–100, `gray=1`, rotate 90/180/270, flip `h`/`v` |
| `wm`, `wm_text` | watermark: an image asset in the same workspace, or up to 60 characters of text |
| `wm_pos`, `wm_w`, `wm_o` | where (`nw` … `se`, default `se`), width as a share of the image (0.05–1, default 0.2), opacity (0–1, default 0.7) |

Unknown parameters and out-of-range values get a 400 that says what's allowed. Output is capped at 16 megapixels,
each asset keeps up to 200 variants (429 after that), and only two renders run at once. Responses are cacheable for a
day (`Vary: Accept` for `f=auto`). The asset page's **Transform** tab builds these URLs visually; its live preview uses
`preview=1`, which renders for workspace members without storing anything.

### Custom metadata

Owners and admins define fields in **Settings → Metadata**: text, long text, number, date, dropdown and multi-select,
optionally required. Values are stored on each asset as `{ fieldId: value }` (`PATCH /api/assets/:id` with
`metadata`, keyed by field ID or key), validated against the field, searched by the library search, and dropdown fields
become filter chips (`m.<fieldId>=<option>` in the URL). The bulk bar can set one field on many assets. Removing an
option or a field removes its values everywhere. API: `/api/fields`.

### Moderation

**Settings → Moderation** picks a mode per workspace: *Off* (default), *Auto-approve unless flagged*, or *Review every
upload*. Checks run when an upload finishes processing: a blocklist (whole words in the title, file name, tags and
custom fields) and, when `ANTHROPIC_API_KEY` is set on the backend and the workspace turns it on, an automatic review
in which Claude looks at the image or three frames of a video. A declined or failed automatic review sends the upload
to a person instead of approving it. Until an asset is approved, its share page, stream, thumbnails and
transformations return 404 to anyone outside the workspace; members can always see it. The **Review** page lists
what's waiting (flagged first) with approve and reject (with a note). API: `/api/moderation/*`. Assets that existed
before moderation was turned on stay approved.

Known limits: one `PUT` per upload (no resumable/multipart yet, so 5 GB max); encoding is CPU-only H.264; captions,
view analytics and signed playback URLs are not built yet.

## What's where

- `app/page.tsx`, `components/` — the landing page (hero, sections, nav, footer)
- `app/(auth)/` — sign in, sign up, forgot/reset password, accept invitation
- `app/dashboard/`, `components/app/` — the dashboard shell and pages; `components/app/media.tsx` holds the asset list and upload queue, `MediaPlayer.tsx` the player; `library.tsx` holds folders, collections, tags and saved searches, and `library-ui/` the Library's sidebar, filters, preview and dialogs
- `app/embed/[id]` — the public player behind share links and iframes
- `backend/server.mts` — the API service; `backend/media/` — media routes, storage (disk or S3), database access and the pipeline worker
- `backend/media/types.mts` — media types shared by both services (the frontend imports them through `lib/media/types.ts`)
- `backend/media/transform.mts`, `fields.mts`, `moderation.mts` — transformations, custom metadata, moderation
- `lib/sample.ts` — sample analytics, API keys, webhooks and billing data (still to be replaced)
- `app/globals.css`, `app/dashboard/dashboard.css` — design tokens and styles

Motion respects `prefers-reduced-motion`.
