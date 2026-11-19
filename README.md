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

Connect two web services to the same repository, branch and repository root. Use Node.js 22 for both.

| Service | Build command | Start command | Settings |
|---|---|---|---|
| Frontend | `npm run build` | `npm start` | Port 3400. Set `BACKEND_URL` to the backend HTTPS origin and `MEDIAEX_API_TOKEN` to the shared server-side secret. |
| Backend | `npm run build:backend` | `npm run start:backend` | Set `PORT` to the assigned service port (default 3401). Set the backend variables below. **The backend image needs FFmpeg** (`ffmpeg` and `ffprobe`). |

Set the same random `MEDIAEX_API_TOKEN` of at least 32 characters on both services. Keep it independent of the session signing secret. Use the backend's `/readyz` for database readiness and `/healthz` for process health. Backend startup runs the auth and media table migrations.

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

Generate each secret separately with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Store production values in service secrets. Register OAuth callbacks at `<BETTER_AUTH_URL>/api/auth/callback/google` or `<BETTER_AUTH_URL>/api/auth/callback/github`.

Without `RESEND_API_KEY` in production, password-reset and invitation emails are skipped (a warning is logged), so set
it before inviting real users.

Container filesystems are wiped on every redeploy, so in production the backend **refuses uploads** (HTTP 503 with an
explanation) until a bucket or a mounted `MEDIA_DIR` is configured; everything else keeps working. Browsers upload
straight to the bucket with presigned URLs, so the bucket needs a CORS rule allowing `PUT` from the frontend origin.
The backend logs which storage it uses at startup.

## How auth works

- `lib/auth.ts` — Better Auth config: email + password, sessions in Postgres (30 days), password reset, email
  verification, and the organization plugin, which provides **workspaces** (owner / admin / member), members and
  invitations. Every new account gets a personal workspace, unless it signed up to accept an invitation.
- `app/api/auth/[...all]/route.ts` — forwards same-origin browser auth requests to `backend/server.mts`.
- `proxy.ts` — fast redirect to `/sign-in` for `/dashboard/*` when there's no session cookie.
- `backend/account.mts` — validates the session and loads the user’s workspaces and membership role for the dashboard. Better Auth enforces workspace permissions on the backend.
- `scripts/migrate.mts` — creates or updates the tables (`npm run db:migrate`).

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

Known limits: one `PUT` per upload (no resumable/multipart yet, so 5 GB max); encoding is CPU-only H.264; captions,
view analytics and signed playback URLs are not built yet.

## What's where

- `app/page.tsx`, `components/` — the landing page (hero, sections, nav, footer)
- `app/(auth)/` — sign in, sign up, forgot/reset password, accept invitation
- `app/dashboard/`, `components/app/` — the dashboard shell and pages; `components/app/media.tsx` holds the asset list and upload queue, `MediaPlayer.tsx` the player
- `app/embed/[id]` — the public player behind share links and iframes
- `backend/server.mts` — the API service; `backend/media/` — media routes, storage (disk or S3), database access and the pipeline worker
- `lib/media/types.ts` — media types shared by both services
- `lib/sample.ts` — sample analytics, API keys, webhooks and billing data (still to be replaced)
- `app/globals.css`, `app/dashboard/dashboard.css` — design tokens and styles

Motion respects `prefers-reduced-motion`.
