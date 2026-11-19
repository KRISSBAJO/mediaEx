# MediaEX

The media cloud for creators and studios: a Next.js 16 (App Router) landing page with a Three.js hero, sign-in, and a
workspace dashboard. Accounts, workspaces and teams are real (Better Auth + Postgres), and so is the media core: uploads,
an FFmpeg pipeline that encodes video and audio to adaptive HLS, a library, playback and share/embed links. Analytics,
API keys, webhooks and billing in the dashboard are still generated sample data (`lib/sample.ts`) and are labelled so.

## Run it locally

You need Node 22, a Postgres database and FFmpeg (`ffmpeg` and `ffprobe` on your PATH). The quickest way to get Postgres is Docker:

```bash
docker run -d --name mediaex-postgres --restart unless-stopped \
  -e POSTGRES_USER=mediaex -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=mediaex \
  -p 127.0.0.1:54340:5432 -v mediaex-pgdata:/var/lib/postgresql/data postgres:17-alpine
```

Then:

```bash
cp .env.example .env.local   # fill in DATABASE_URL and BETTER_AUTH_SECRET
npm install
npm run db:migrate           # creates the auth and media tables
npm run dev                  # http://localhost:3400
```

Create an account at `/sign-up`. Without `RESEND_API_KEY`, emails (verification, password reset, invitations) are not
sent; they appear at **http://localhost:3400/dev/mailbox** instead (development only — that page is a 404 in production).

## Environment variables

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `BETTER_AUTH_SECRET` | yes | 32+ random bytes; signs sessions. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `BETTER_AUTH_URL` | yes | Public URL of the app, no trailing slash (e.g. `https://mediaex.example.com`) |
| `RESEND_API_KEY`, `MAIL_FROM` | no | Real email through [Resend](https://resend.com). When set, new accounts must verify their email before signing in |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Shows the Google button on sign-in/sign-up |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | no | Shows the GitHub button on sign-in/sign-up |
| `MEDIA_DIR` | no | Where media is stored on local disk (default `./.media`). Used when no bucket is configured |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | for production | An S3-compatible bucket (Cloudflare R2, AWS S3, MinIO). Setting `S3_BUCKET` switches storage to it |
| `MAX_UPLOAD_BYTES` | no | Largest upload accepted (default 5 GiB) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | no | Only if FFmpeg isn't on the PATH |
| `MEDIA_WORKER` | no | `off` stops this instance from encoding (it still serves requests) |

For Google/GitHub, the OAuth callback URL is `<BETTER_AUTH_URL>/api/auth/callback/google` (or `/github`).

## Deploying (Hoist or any Node host)

1. **Use a hosted Postgres.** Hoist can't host databases yet (managed Postgres and volumes are on its roadmap), so use
   one outside it — e.g. a free [Neon](https://neon.tech) or Supabase database — and put its connection string in
   `DATABASE_URL`.
2. **Set the environment variables** above in the host. `BETTER_AUTH_URL` must be the deployed URL, not localhost.
3. **Give media somewhere to live.** Hoist containers have no persistent disk yet, so files on local disk vanish on
   redeploy. Create a bucket (Cloudflare R2 is cheapest for video: no egress fees), set the `S3_*` variables, and add a
   CORS rule to the bucket that allows `PUT` from your app's URL — browsers upload straight to the bucket.
4. **Deploy.** The repo's `Dockerfile` installs FFmpeg, builds the app, runs the migrations and starts the server (the
   media worker starts with it). Hosts that run `npm start` instead get migrations through the `prestart` script, but
   must provide FFmpeg themselves.

Without `RESEND_API_KEY` in production, password-reset and invitation emails are skipped (a warning is logged), so set
it before inviting real users.

## How auth works

- `lib/auth.ts` — Better Auth config: email + password, sessions in Postgres (30 days), password reset, email
  verification, and the organization plugin, which provides **workspaces** (owner / admin / member), members and
  invitations. Every new account gets a personal workspace, unless it signed up to accept an invitation.
- `app/api/auth/[...all]/route.ts` — all auth endpoints.
- `proxy.ts` — fast redirect to `/sign-in` for `/dashboard/*` when there's no session cookie.
- `app/dashboard/layout.tsx` — the real check: validates the session against the database and loads the user, their
  workspaces and their role. Permissions (who can invite, rename, delete) are enforced by Better Auth on the server; the
  UI only hides what you can't do.
- `scripts/migrate.mts` — creates or updates the tables (`npm run db:migrate`).

## How media works

1. **Upload.** The dashboard asks `POST /api/uploads` for a slot; the server creates the asset (status `uploading`) and
   returns where to `PUT` the file: the app itself for local disk, or a presigned bucket URL. When the transfer
   finishes, `POST /api/uploads/:id/complete` checks the size and queues the asset.
2. **Pipeline.** `lib/media/worker.ts` runs inside the server process (started from `instrumentation.ts`). It claims
   queued assets from Postgres (`for update skip locked`, so several instances can share the queue) and runs FFmpeg:
   - *Analyse*: ffprobe for type, codec, size, duration; a thumbnail frame (or a waveform for audio).
   - *Encode*: video → H.264/AAC HLS ladder at 1080p, 720p, 480p, 360p (never above the source); audio → AAC HLS;
     images → a 2560 px poster.
   - *Package*: master playlist, sizes, and (with a bucket) publishing to storage.
   Progress is written to the asset row; the dashboard polls `/api/assets` while anything is in flight.
   Jobs interrupted by a restart are picked up again after two minutes, up to three attempts.
3. **Playback.** `/api/media/:id/…` serves playlists, segments, thumbnails and posters to anyone with the link (asset
   IDs are random), so share links (`/embed/:id`) and iframes work. The original is a members-only download.

Known limits: one `PUT` per upload (no resumable/multipart yet, so 5 GB max); encoding is CPU-only H.264; captions,
view analytics and signed playback URLs are not built yet.

## What's where

- `app/page.tsx`, `components/` — the landing page (hero, sections, nav, footer)
- `app/(auth)/` — sign in, sign up, forgot/reset password, accept invitation
- `app/dashboard/`, `components/app/` — the dashboard shell and pages
- `lib/media/` — media types, storage (disk or S3), database access and the pipeline worker
- `app/api/uploads`, `app/api/assets`, `app/api/media` — upload, library and playback endpoints
- `app/embed/[id]` — the public player behind share links and iframes
- `lib/sample.ts` — sample analytics, API keys, webhooks and billing data (still to be replaced)
- `app/globals.css`, `app/dashboard/dashboard.css` — design tokens and styles

Motion respects `prefers-reduced-motion`.
