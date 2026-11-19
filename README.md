# MediaEX

The media cloud for creators and studios: a Next.js 16 (App Router) landing page with a Three.js hero, sign-in, and a
workspace dashboard, with a separate Node.js API. Accounts, workspaces and teams are real (Better Auth + Postgres). Media, uploads and analytics in
the dashboard are still generated sample data (`lib/sample.ts`) until the media backend exists.

## Run it locally

You need Node 22 and a Postgres database. The quickest way to get Postgres is Docker:

```bash
docker run -d --name mediaex-postgres --restart unless-stopped \
  -e POSTGRES_USER=mediaex -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=mediaex \
  -p 127.0.0.1:54340:5432 -v mediaex-pgdata:/var/lib/postgresql/data postgres:17-alpine
```

Then:

```bash
cp .env.example .env.local   # fill in DATABASE_URL and BETTER_AUTH_SECRET
npm ci
npm run dev:backend          # terminal 1: migrates Postgres and starts the API on port 3401
npm run dev                  # terminal 2: frontend at http://localhost:3400
```

Create an account at `/sign-up`. Without `RESEND_API_KEY`, emails (verification, password reset, invitations) are not
sent; they appear at **http://localhost:3400/dev/mailbox** instead (development only — that page is a 404 in production).

## Deploying on Hoist

Connect two web services to the same repository, branch and repository root. Use Node.js 22 for both.

| Service | Build command | Start command | Settings |
|---|---|---|---|
| Frontend | `npm run build` | `npm start` | Port 3400. Set `BACKEND_URL` to the backend HTTPS origin and `MEDIAEX_API_TOKEN` to the shared server-side secret. |
| Backend | `npm run build:backend` | `npm run start:backend` | Set `PORT` to the assigned service port (default 3401). Set the backend variables below. |

Set the same random `MEDIAEX_API_TOKEN` of at least 32 characters on both services. Keep it independent of the session signing secret. Use the backend's `/readyz` for database readiness and `/healthz` for process health. Backend startup runs the auth table migrations.

| Backend variable | Purpose |
|---|---|
| `DATABASE_URL` | Renviq Postgres connection string with TLS and permission to manage the auth tables |
| `BETTER_AUTH_SECRET` | Session signing secret. Generate 32 random bytes and keep the value across releases. |
| `BETTER_AUTH_URL` | Public HTTPS **frontend** origin, e.g. `https://mediaex.example.com`. This is the origin for cookies, callbacks and emailed links. |
| `RESEND_API_KEY`, `MAIL_FROM` | Optional production email delivery. With a Resend API key, new accounts must verify their email. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google sign-in |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional GitHub sign-in |

Generate each secret separately with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Store production values in service secrets. Register OAuth callbacks at `<BETTER_AUTH_URL>/api/auth/callback/google` or `<BETTER_AUTH_URL>/api/auth/callback/github`.

Without `RESEND_API_KEY` in production, password-reset and invitation emails are skipped (a warning is logged), so set
it before inviting real users.

## How auth works

- `lib/auth.ts` — Better Auth config: email + password, sessions in Postgres (30 days), password reset, email
  verification, and the organization plugin, which provides **workspaces** (owner / admin / member), members and
  invitations. Every new account gets a personal workspace, unless it signed up to accept an invitation.
- `app/api/auth/[...all]/route.ts` — forwards same-origin browser auth requests to `backend/server.mts`.
- `proxy.ts` — fast redirect to `/sign-in` for `/dashboard/*` when there's no session cookie.
- `backend/account.mts` — validates the session and loads the user’s workspaces and membership role for the dashboard. Better Auth enforces workspace permissions on the backend.
- `scripts/migrate.mts` — creates or updates the tables (`npm run db:migrate`).

## What's where

- `app/page.tsx`, `components/` — the landing page (hero, sections, nav, footer)
- `app/(auth)/` — sign in, sign up, forgot/reset password, accept invitation
- `app/dashboard/`, `components/app/` — the dashboard shell and pages
- `lib/sample.ts` — sample media and analytics data (replace with real APIs when the media backend exists)
- `app/globals.css`, `app/dashboard/dashboard.css` — design tokens and styles

Motion respects `prefers-reduced-motion`.
