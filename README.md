# MediaEX

The media cloud for creators and studios: a Next.js 16 (App Router) landing page with a Three.js hero, sign-in, and a
workspace dashboard, with a separate Node.js API. Accounts, workspaces and teams are real (Better Auth + Postgres), and
so is the media core: uploads, an FFmpeg pipeline that encodes video and audio to adaptive HLS, a library, playback and
share/embed links, with resumable uploads, HEVC/AV1, captions, signed playback, view analytics, API keys, webhooks
and Stripe or Paystack billing.

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
| `MAX_UPLOAD_BYTES` | Largest upload accepted (default 50 GiB; anything over 5 GiB goes up in parts) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Only if FFmpeg isn't on the PATH |
| `MEDIA_WORKER` | `off` runs an API-only instance that doesn't encode |
| `MAX_VARIANTS_PER_ASSET` | Cached transformation variants kept per asset (default 200) |
| `ANTHROPIC_API_KEY` | Optional. Lets workspaces turn on automatic image review in moderation (Claude looks at images and video frames) |
| `API_RATE_LIMIT_PER_MINUTE` | Requests per minute allowed for each API key on `/api/v1` (default 120) |
| `PUBLIC_API_URL` | Optional. The origin API callers use, if it differs from `BETTER_AUTH_URL` (used in upload URLs handed to key callers) |
| `MEDIA_HW_ENCODER` | Optional. `nvenc` (NVIDIA) or `qsv` (Intel Quick Sync) to encode on the GPU. Needs an FFmpeg build with those encoders (the default image's Alpine FFmpeg has neither); anything the GPU can't do falls back to the CPU |
| `OPENAI_API_KEY` | Optional. Turns on automatic captions (OpenAI Whisper). `OPENAI_TRANSCRIBE_MODEL` (default `whisper-1`) and `OPENAI_BASE_URL` change the model and endpoint |
| `NEXT_PUBLIC_LEGAL_EMAIL` | Frontend, build time. The contact address on `/terms` and `/privacy` |
| `BILLING_PROVIDER` | `stripe` or `paystack`. Without it, whichever of the two has a key is used; with neither, every workspace stays on Creator |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe billing. Point a webhook at `<BETTER_AUTH_URL>/api/billing/webhook/stripe` for `checkout.session.completed`, `customer.subscription.*` and `invoice.payment_failed`, and turn on the Customer Portal |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_CURRENCY`, `PAYSTACK_PRICES` | Paystack billing. Webhook URL `<BETTER_AUTH_URL>/api/billing/webhook/paystack`. `PAYSTACK_CURRENCY` defaults to NGN; for anything but USD set `PAYSTACK_PRICES="pro_month=…,pro_year=…,studio_month=…,studio_year=…"` in that currency's main unit |

Generate each secret separately with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Store production values in service secrets. Register OAuth callbacks at `<BETTER_AUTH_URL>/api/auth/callback/google` or `<BETTER_AUTH_URL>/api/auth/callback/github`.

Production password resets require `RESEND_API_KEY` and a verified `MAIL_FROM` on the backend. If either is missing, the reset form reports that delivery is unavailable for every address. The API retries queued reset emails until their links expire.

Container filesystems are wiped on every redeploy, so in production the backend **refuses uploads** (HTTP 503 with an
explanation) until a bucket or a mounted `MEDIA_DIR` is configured; everything else keeps working. Browsers upload
straight to the bucket with presigned URLs, so the bucket needs a CORS rule allowing `PUT` from the frontend origin.
### Private object storage pilot

MediaEX records the store for each asset in Postgres. The database also holds workspace ownership, library metadata, review decisions and playback policy. Originals, renditions, captions and transformations use the store assigned to the asset.

1. On an existing volume deployment keep the mount and set `MEDIAEX_LEGACY_STORAGE=local`. On an existing bucket deployment set it to `s3`. Migrate the database with the previous store available. The first bucket configuration binds the database to that bucket endpoint and name.
2. Set `MEDIAEX_S3_WORKSPACE_IDS` to the comma-separated IDs of participating workspaces. An explicitly empty value sends all **new** uploads to disk. An unset value preserves the previous single-store deployment. Changing the list does not move existing objects. Keep both stores available while their assets exist.
3. Configure the bucket credentials only on the backend. `S3_SESSION_TOKEN` is supported for temporary credentials. Use private objects and allow the exact dashboard origin to read and upload media. The bucket CORS policy must permit GET, HEAD and PUT, the upload request headers including Content-Type and If-None-Match, and expose ETag for multipart uploads. Verify a browser upload, a completed encode and a signed playback link through expiry before onboarding another workspace.
4. To inventory old volume assets run `node --experimental-strip-types backend/migrate-media-storage.mts --workspace ID` from the repository root (omit `backend/` when executing inside the backend image directory). Select a single asset with `--asset ID`. Forward migration covers eligible, ready disk assets without historical revisions. The operator first drains media writers, including transformations, then supplies `--apply --writers-stopped`. The command verifies object checksums before changing the asset record and keeps the local recovery copy. For rollback, use the same asset and flags plus `--rollback`; both inventories must still match the receipt.

**Recovery and reporting.** Workspace owners and admins manage upload policies in Settings → Upload presets. Trash offers a 30-day restore window. A restore needs the stored media objects and their database records. Back up Postgres alongside media files and verify that the pair can be restored. The Usage and errors page shows measured media usage. Transfer reported by players is a partial measurement. `MEDIA_CLEAN_EXPIRED_UPLOADS=on` enables background disposal of expired upload reservations and expired Trash. Leave it unset to inspect the release before enabling disposal. Previously issued object URLs can be used until their expiry.

## How auth works

- `backend/auth.mts` — Better Auth config: email + password, sessions in Postgres (30 days), password reset, email
  verification, and the organization plugin, which provides **workspaces** (owner / admin / member), members and
  invitations. Every new account gets a personal workspace, unless it signed up to accept an invitation.
- `app/api/auth/[...all]/route.ts` — forwards same-origin browser auth requests to `backend/server.mts`.
- `proxy.ts` — fast redirect to `/sign-in` for `/dashboard/*` when there's no session cookie.
- `backend/account.mts` — validates the session and loads the user’s workspaces and membership role for the dashboard. Better Auth enforces workspace permissions on the backend.
- `backend/migrate.mts` — creates or updates the tables (`npm run db:migrate`).

Site administrators must verify the email on their MediaEX account. To bootstrap the first administrator, set `SITE_ADMIN_EMAILS` on the backend and complete the verification link for that address or sign in through a configured identity provider that confirms email ownership. Production verification emails require a working `RESEND_API_KEY` and sender. Existing verified accounts on the list are recognized during migration. Existing site admins can promote another verified account from **Site Admin → Administrators**.

## How media works

The frontend only renders and forwards; everything that touches files or the database runs in the backend.

1. **Upload.** The dashboard asks `POST /api/uploads` for a slot; the backend creates the asset (status `uploading`) and
   returns where to `PUT` the file: a presigned bucket URL, or (local disk) `/api/uploads/:id`, which streams through
   the frontend to the backend. `POST /api/uploads/:id/complete` checks the size and queues the asset.
   Files from 64 MB (and anything over 5 GiB, from any caller) go up **in parts**: 16 MiB or larger, four at a time,
   each retried on its own with backoff. `GET /api/uploads/:id/parts` says which have arrived, so the dashboard picks an
   interrupted upload up again when the same file is added; `complete` joins them (S3 multipart upload, or local part
   files). The server lists the parts itself, so buckets don't need to expose `ETag` to the browser.
2. **Pipeline.** `backend/media/worker.mts` runs inside the backend process. It claims queued assets from Postgres
   (`for update skip locked`, so several instances can share the queue) and runs FFmpeg:
   - *Analyse*: ffprobe for type, codec, size, duration; a thumbnail frame (or a waveform for audio).
   - *Encode*: video → H.264/AAC HLS ladder up to the plan's ceiling (1080p on Creator, 4K on Pro, 8K on Studio), never
     above the source; audio → AAC HLS; images → a 2560 px poster. Workspaces on Pro and Studio can add **HEVC and AV1**
     ladders (Settings → Encoding, `backend/media/encoding.mts`), packaged as fMP4 HLS under `hls/hevc/` and `hls/av1/`;
     the player picks the smallest one the device decodes and falls back to H.264. `MEDIA_HW_ENCODER` moves encoding
     to the GPU, with a CPU retry if the GPU fails.
   - *Package*: master playlist, sizes, and publishing to the bucket.
   Progress is written to the asset row; the dashboard polls `/api/assets` while anything is in flight.
   Jobs interrupted by a restart are picked up again after two minutes, up to three attempts.
3. **Playback.** `/api/media/:id/…` serves playlists, thumbnails and posters to anyone with the link (asset IDs are
   random), so share links (`/embed/:id`) and iframes work; with a bucket, playlists list signed segment URLs
   (valid 6 hours) that players fetch straight from the bucket. The original is a members-only download.
   An asset set to **signed links only** needs a playback token (`?token=<expiry>.<HMAC-SHA256 of "assetId:expiry">`)
   for everything a viewer loads; playlists pass the token on to every segment. Tokens come from
   `POST /api/assets/:id/playback-token`, `POST /api/v1/assets/:id/playback-token`, or the customer's own server using
   the workspace secret (Developers → Playback signing). See `backend/media/playback.mts`.
4. **Captions.** WebVTT tracks per language: uploaded (VTT or SRT), or transcribed by OpenAI Whisper when
   `OPENAI_API_KEY` is set (per asset, or for every new upload with Settings → Encoding → Captions). The player shows a
   CC button; `asset.captions_ready` fires when a transcription finishes. See `backend/media/captions.mts`.
5. **Analytics.** The share/embed player sends a heartbeat every 15 seconds and when playback stops (watch time, the
   furthest point reached, time to first frame, stalls, bytes). Country comes from a CDN header when there is one,
   otherwise from the viewer's time zone. Dashboard previews and other players aren't counted. `GET /api/analytics`
   and `GET /api/v1/analytics`; see `backend/media/analytics.mts`.
6. **Billing.** Plans and their limits live in `backend/media/billing.mts`: storage is checked when an upload starts,
   processing minutes when it's queued, and the plan sets the ladder's ceiling and whether HEVC/AV1 are allowed.
   Stripe (Checkout + Customer Portal) or Paystack (plans created on first use) take payment; signed webhooks keep the
   `subscription` table current, and each event is handled once.

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

Known limits: HDR sources are encoded as SDR; captions aren't translated into other languages; Studio storage past
10 TB is reported but not yet charged automatically.

## Developer platform

Everything the dashboard can do with media, a customer's own servers can do with an **API key**, and **webhooks** tell
them when something happens. Both are managed on the dashboard's **Developers** page.

### API keys

- Keys look like `mx_live_` followed by 32 random base62 characters. The full key is shown once, when it's created;
  the database stores only its SHA-256 hash and last four characters.
- Each key belongs to a workspace and has a scope: `read` (list and read assets and folders), `upload` (read, plus
  uploads) or `full` (everything, including edits and deletes).
- Owners and admins create and revoke keys (`/api/keys`, up to 50 active per workspace); every member can see the list.
  Revoking takes effect on the next request.
- Each key is rate limited with a token bucket: `API_RATE_LIMIT_PER_MINUTE` requests a minute (default 120). Over the
  limit, the API answers 429 with a `Retry-After` header. The bucket is kept in memory per backend instance.
- Keys work only on `/api/v1`. A key sent to the dashboard routes, or a session cookie sent to `/api/v1`, is refused.

### Public API: `/api/v1`

Send `Authorization: Bearer mx_live_…` to the frontend origin, which forwards `/api/v1` to the backend.

| Endpoint | Scope | Does |
|---|---|---|
| `GET /api/v1/whoami` | read | The key's workspace, name and scope |
| `GET /api/v1/assets?q=&folder=&type=&status=&tags=&date=&sort=&limit=&offset=` | read | Search, same parameters as the Library; `limit` up to 100, `nextOffset` for the next page |
| `GET /api/v1/assets/:id` | read | One asset |
| `PATCH /api/v1/assets/:id` | full | `{ title?, tags?, folderId?, metadata? }` |
| `DELETE /api/v1/assets/:id` | full | Deletes the asset and its files |
| `POST /api/v1/assets/:id/retry` | full | Runs the pipeline again |
| `GET /api/v1/uploads/presets` | read | List the workspace's named upload presets and their IDs |
| `POST /api/v1/uploads` | upload | `{ fileName, size, mimeType?, folderId?, presetId?, multipart? }` returns the asset and where to `PUT` the file |
| `PUT /api/v1/uploads/:id` | upload | The file itself, when `upload.url` points here (local-disk storage); with a bucket it's a presigned URL instead |
| `POST /api/v1/uploads/:id/complete` | upload | Checks the file arrived and queues it for processing |
| `GET /api/v1/folders` | read | The workspace's folders with asset counts |

Owners and admins manage upload presets in **Settings → Upload presets**. Choose a preset in **Uploads** or pass its ID as `presetId`. Omitting the ID applies the workspace default, if configured. Each upload retains the policy it started with. A preset controls allowed media types, original size and dimensions, duration, the video rendition ceiling, destination folder, signed playback and whether review is required. Input checks run again on the stored media before publication. When uploading to a bucket, send the returned `upload.headers` and the exact announced body length. Browser uploads set Content-Length automatically.

Responses use the dashboard's asset shape, with absolute thumbnail, poster and playback URLs. Uploads made with a key
show "API key: <name>" as their uploader. Errors are `{ "error": "…" }` with a matching status. The router is
`backend/media/v1.mts`.

### Webhooks

Owners and admins add HTTPS endpoints (`/api/webhooks`, up to 20 per workspace) and pick the events they want:

| Event | When |
|---|---|
| `asset.ready` | An upload finished processing and can stream |
| `asset.failed` | Processing failed |
| `asset.deleted` | An asset was deleted (the payload has the asset as it was) |
| `asset.review_required` | Moderation is holding an upload for review |
| `asset.approved`, `asset.rejected` | Someone decided on an asset in review |

Each delivery is a `POST` with a JSON body `{ id: "evt_…", type, created, workspace, data: { asset } }` and these
headers: `MediaEX-Event`, `MediaEX-Delivery` (the delivery ID) and
`MediaEX-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the endpoint's secret>`. Receivers
should recompute the HMAC over the raw body, compare in constant time and reject old timestamps. The Developers page
has a ready-made Node snippet. Secrets (`whsec_…`) can be revealed and rotated.

- **Delivery.** A 2xx answer within 10 seconds counts as delivered. Anything else (another status, a timeout, a
  redirect) is retried after 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h and 12 h, about a day in total, then the
  delivery is marked failed. Deliveries are rows in Postgres claimed with `for update skip locked`, so retries survive
  restarts and every backend instance helps send them.
- **The log.** The Developers page lists the last 100 deliveries with the payload, your server's answer, a "send again"
  button and a test event per endpoint (`webhook.test`). Each endpoint shows its health (consecutive failures) and a
  7-day success count. A disabled endpoint gets no new deliveries.
- **SSRF guard.** Endpoints must use HTTPS. In production, the host is resolved before every delivery and private,
  loopback, link-local and CGNAT addresses are refused. In development, `http://localhost` is allowed so you can test
  against a local receiver.

The code is in `backend/media/webhooks.mts` (endpoints, signing, dispatcher, `emitAsset`) and `backend/media/keys.mts`.

## What's where

- `app/page.tsx`, `components/` — the landing page (hero, sections, nav, footer)
- `app/(auth)/` — sign in, sign up, forgot/reset password, accept invitation
- `app/dashboard/`, `components/app/` — the dashboard shell and pages; `components/app/media.tsx` holds the asset list and upload queue, `MediaPlayer.tsx` the player; `library.tsx` holds folders, collections, tags and saved searches, and `library-ui/` the Library's sidebar, filters, preview and dialogs
- `app/embed/[id]` — the public player behind share links and iframes
- `backend/server.mts` — the API service; `backend/media/` — media routes, storage (disk or S3), database access and the pipeline worker
- `backend/media/types.mts` — media types shared by both services (the frontend imports them through `lib/media/types.ts`)
- `backend/media/transform.mts`, `fields.mts`, `moderation.mts` — transformations, custom metadata, moderation
- `backend/media/keys.mts`, `v1.mts`, `webhooks.mts` — API keys, the public API and webhooks
- `backend/media/playback.mts`, `analytics.mts`, `encoding.mts`, `captions.mts`, `billing.mts` — signed playback, view analytics, codecs and GPU encoding, captions, plans and billing
- `lib/sample.ts` — formatting helpers (bytes, durations, compact numbers) and leftover sample data
- `app/globals.css`, `app/dashboard/dashboard.css` — design tokens and styles

Motion respects `prefers-reduced-motion`.
