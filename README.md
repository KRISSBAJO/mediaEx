# MediaEX

The media cloud for creators and studios: a Next.js 16 (App Router) landing page with a Three.js hero, sign-in, and a
workspace dashboard. Accounts, workspaces and teams are real (Better Auth + Postgres). Media, uploads and analytics in
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
npm install
npm run db:migrate           # creates the auth tables
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

For Google/GitHub, the OAuth callback URL is `<BETTER_AUTH_URL>/api/auth/callback/google` (or `/github`).

## Deploying (Hoist or any Node host)

1. **Use a hosted Postgres.** Hoist can't host databases yet (managed Postgres and volumes are on its roadmap), so use
   one outside it — e.g. a free [Neon](https://neon.tech) or Supabase database — and put its connection string in
   `DATABASE_URL`.
2. **Set the environment variables** above in the host. `BETTER_AUTH_URL` must be the deployed URL, not localhost.
3. **Deploy.** `npm start` runs `npm run db:migrate` first (the `prestart` script), so tables are created or updated
   automatically on every start. It's safe to run repeatedly.

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

## What's where

- `app/page.tsx`, `components/` — the landing page (hero, sections, nav, footer)
- `app/(auth)/` — sign in, sign up, forgot/reset password, accept invitation
- `app/dashboard/`, `components/app/` — the dashboard shell and pages
- `lib/sample.ts` — sample media and analytics data (replace with real APIs when the media backend exists)
- `app/globals.css`, `app/dashboard/dashboard.css` — design tokens and styles

Motion respects `prefers-reduced-motion`.
