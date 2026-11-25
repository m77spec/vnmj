# Deployment Guide

LaxaLab supports three deployment targets:

1. **Render Blueprint** (`render.yaml`) — deploys the APIs, database, cache, and
   (optionally) both frontends.
2. **Cloudflare Workers** (`frontend/wrangler.*.jsonc`) — deploys the learner
   and admin Next.js frontends separately; the APIs can remain on Render.
3. **Railway (managed)** — no servers to run or patch.
4. **Self-hosted Docker Compose** (`docker-compose.prod.yml`) — full TLS via
   Let's Encrypt, nginx in front of the Next.js frontend and NestJS backend.

Pick one per environment. Use `.env.production.example` for the self-hosted target and the service-specific
checklists below for managed deployments.

## Cloudflare Workers: frontend deployment

The Next.js frontend uses dynamic routes, cookies, and middleware, so deploy it
to **Cloudflare Workers with `@opennextjs/cloudflare`**, not as a static Pages
site. Two independent Workers are configured:

- `laxalab-student` serves the student and instructor platform.
- `laxalab-admin` serves the admin console.

The APIs, PostgreSQL, Redis, and uploaded files remain on their existing
providers. The Worker configs currently point at the Render APIs and the
existing frontend domains. Each Worker uses the repository root with
`frontend/` as its root directory, Node.js compatibility, and its own Wrangler
config (`wrangler.learner.jsonc` or `wrangler.admin.jsonc`). Cloudflare builds
need Node.js 22.12 or newer for the Wrangler CLI.

### Connect and deploy

1. Push the Cloudflare deployment files and frontend dependency lockfile to a
   GitHub branch Cloudflare can access. Connect GitHub in Cloudflare Workers.
2. Create two Workers from the same repository. For each, set the root
   directory to `frontend` and set the build command to `npm ci` followed by
   the matching `npm run cf:build:learner` or `npm run cf:build:admin`
   command. Set the deploy command to `npm run cf:deploy:learner` or
   `npm run cf:deploy:admin`, respectively.
3. In each Worker build's environment variables, set
   `NEXT_PUBLIC_APP_MODE` (`learner` or `admin`), `NEXT_PUBLIC_API_URL` to
   that surface's public Render API URL, and `NEXT_PUBLIC_SITE_URL` to its
   final HTTPS domain. These `NEXT_PUBLIC_*` values are baked into the app at
   build time; set them separately for both Workers and rebuild after changing
   them. `wrangler.*.jsonc` also declares the corresponding public runtime
   values and surface mode.
4. Deploy to the `workers.dev` address first. In Cloudflare, attach the
   intended custom domain to each Worker (learner: `laxalab.com` and optionally
   `www.laxalab.com`; admin: `m.o2.h.laxalab.com`) and confirm DNS. Update
   `NEXT_PUBLIC_SITE_URL` and rebuild if the final domain differs.
5. Add each final frontend origin to `CORS_ORIGINS` on its matching Render API
   service if it is not already allowed. The current Render config already
   allows the documented learner and admin domains. Test login, locale routing,
   dashboard navigation, uploads, and API calls on both Workers.

For a local command-line deployment instead of Git integration, run
`npx wrangler login` from `frontend/`, then build and deploy each Worker using
the matching `cf:build:*` and `cf:deploy:*` scripts. Build-time variables must
be set in the shell before each build. Do not copy Render API secrets into
Cloudflare: the browser frontends only need the public API URLs; private
integration secrets remain on the API services.

## Target 1: Render (free evaluation)

The root [render.yaml](./render.yaml) Blueprint describes six resources:

- `laxalab-web-learner` and `laxalab-web-admin`: separate web origins.
- `laxalab-api-public` and `laxalab-api-admin`: separate APIs. The public API
  refuses admin-audience tokens; the admin API accepts only admin sessions.
- `laxalab-postgres`: one shared PostgreSQL database.
- `laxalab-redis`: a private shared cache and rate-limit store used by both APIs.

Both APIs use the same Cloudflare R2 bucket for uploads, so avatars, course
media, chat attachments, assignments, receipts, and CVs remain available across
the two API origins. Private receipts and CVs are still served only by their
authenticated download routes; R2 itself is not exposed as a public bucket.

The frontend build commands copy `.next/static` and `public` into the standalone
server output so the production server can serve its JavaScript, CSS, and public
assets after deployment. The start command binds the server to `0.0.0.0` so
Render's proxy can reach the process inside its container.

### Google Analytics 4

The learner frontend supports GA4 page views and key funnel events. Set
`NEXT_PUBLIC_GA4_ID` to the property's `G-...` Measurement ID on the
`laxalab-web-learner` Render service, then redeploy; Next.js embeds this public
configuration during the build. GA4 loads only after a visitor grants analytics
consent. Page views, sign-up, login, course views, enrollment checkout attempts,
and contact leads are sent without personal identifiers. Public-page button and
link clicks are grouped by their visible label; dashboard clicks are excluded.
Configure Enhanced Measurement in GA4 for automatic scroll and outbound-click events. Enrollment
applications awaiting manual payment approval are not reported as completed
purchases.

### Re-creating the Blueprint in another Render workspace

1. Create a Cloudflare R2 bucket and an API token with read/write access to that
   bucket. Record the S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`),
   bucket name, access key ID, and secret access key. Do not commit these values.
2. Confirm that your Render workspace has no other free PostgreSQL database or
   Key Value instance; Render limits each workspace to one active free instance
   of each type.
3. Push this repository, including `render.yaml`, to GitHub. The existing
   Render Blueprint is linked to `MMMHH5/ss22`, branch `render-deploy`.
4. In the new Render workspace, choose **New → Blueprint**, connect
   `MMMHH5/ss22`, and select `render-deploy` (or the branch containing this
   file). Review the six resources before applying the Blueprint. Enter the R2
   endpoint, bucket, access key ID, and secret access key for both API services
   (use the same bucket and token). Also supply the Google OAuth credentials
   and any optional Sentry and frontend analytics values you use. Render
   generates a separate JWT secret for each API; never copy JWT secrets between
   environments.
5. After the deploy completes, test both frontend URLs and each API's
   `/health` endpoint. Check the API logs for successful database migrations.

### Deployment handoff: what to save before moving

The repository saves the application code, dependency lockfiles, Prisma
migrations, Docker configuration, and the Render service topology in
`render.yaml`. The current Render Blueprint is `laxalab-platforms`
(`exs-dbisko6tlv9c73bk6rig`), linked to `MMMHH5/ss22` on `render-deploy`.
Its resources are the four web services listed above, `laxalab-postgres`, and
`laxalab-redis`. These identifiers describe the current workspace only; a new
workspace creates its own resources and URLs.

The Blueprint is **not** a backup. It does not contain secret values, database
records, or files stored in R2. Before access to the old workspace is lost:

1. In your password manager or encrypted vault, create a record named
   `LaxaLab — Render deployment — <environment>` (for example,
   `LaxaLab — Render deployment — production`). Use this guide as the
   non-secret reference for that record. Save the current values of secret
   environment variables in the vault, not in this repository. Render's
   `sync: false` entries are prompts for values and do not save those values
   in this repository. Do not copy
   `.env`, `.env.production`, `.seed-creds`, passwords, tokens, or connection
   strings into Git, this guide, or chat. If an old secret is unavailable,
   rotate/create a replacement with its provider.
2. Record the domains and DNS provider/account, Google OAuth client and its
   authorized callback URL, Stripe webhook configuration, email provider,
   Cloudflare account/bucket and API token, and any Sentry/GA4 project IDs.
   Keep credentials and recovery codes in the vault, not in this checklist.
3. If preserving live data, make and verify a PostgreSQL backup and copy all
   objects from the old R2 bucket to the new bucket, retaining each object's
   exact key (including `uploads/...`). A new Blueprint creates an empty
   database and bucket settings alone do not copy files. Redis contains
   disposable cache/rate-limit data and does not need migration.
4. Plan a maintenance window for a live move: stop writes to the old app,
   take the final database backup, restore it to the new database, copy/check
   R2 objects, and validate the new services before changing DNS or directing
   users to them. Do not point production traffic at an empty database or
   incomplete file store.

#### Render environment-variable checklist

Set these in Render's environment settings, not in committed files. Resource
references and generated values are already described in `render.yaml`.

| Service | Variables to set or review |
|---|---|
| `laxalab-api-public` | Required integrations: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Google sign-in: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`. Set `FRONTEND_URL` and `CORS_ORIGINS` to the new learner site origins. If enabled: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`; `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; `ADMIN_EMAIL`; `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`. |
| `laxalab-api-admin` | Required integrations: the same four R2 values. Set `FRONTEND_URL` and `CORS_ORIGINS` to the new admin site origin. If enabled: SMTP values above, `ADMIN_EMAIL`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`. Set `OPERATIONS_KEY` only for initial operations-password setup; remove it after setting the password in the app. |
| `laxalab-web-learner` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_MODE=learner`. Optional: `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. |
| `laxalab-web-admin` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_MODE=admin`. Optional: `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. |

Both APIs must use the **same** R2 bucket and credentials, PostgreSQL database,
and Redis resource. Keep the two API `JWT_SECRET` values unique; Render
generates them. `DATABASE_URL` and `REDIS_URL` are supplied by the Blueprint
resource references. Add secrets only to the service(s) that need them.
`NEXT_PUBLIC_*` settings are embedded at frontend build time, so changing a
frontend URL or public monitoring/analytics ID requires rebuilding and
redeploying that frontend.

When service URLs or custom domains change, update the frontend API/site URLs,
the matching API `FRONTEND_URL` and `CORS_ORIGINS`, Google OAuth's authorized
redirect URI (`GOOGLE_CALLBACK_URL`), and the DNS/custom-domain settings.
Register Stripe's webhook endpoint at
`https://<new-public-api-host>/webhooks/stripe` and save its newly issued
signing secret as `STRIPE_WEBHOOK_SECRET`. Verify each integration at its
provider; changing a URL in Render alone does not update OAuth, Stripe, or DNS.

#### Move verification

- Confirm all four web services and both APIs are healthy; test `/health` on
  each API and load both frontend sites.
- Sign in with an admin account, verify two-factor setup, and test a learner
  flow. The Blueprint does not copy user accounts or provision an admin.
- Check API logs for completed database migrations and verify email, Google
  sign-in, payments/webhooks, and file upload/download if those integrations
  are enabled.
- Verify representative database records and R2 files before switching traffic.

### Automated learning notifications

The API runs a daily reminder job at 08:00 `Asia/Riyadh` and catches up student
reminders when an API instance starts. It creates in-app notifications for
approved students with tasks due or live sessions scheduled within the next
24 hours, and sends instructors a daily count of ungraded submissions and
absences recorded during the previous 24 hours. Notifications are deduplicated
in PostgreSQL, so running the job on both API services does not send duplicate
reminders. Students can turn task and session reminders off, and instructors can
turn the daily follow-up summary off, from the notifications page. New accounts
and users without saved preferences receive all applicable reminder types. No
email is sent by this job.

The Blueprint uses absolute public `onrender.com` URLs for frontend API
requests and site metadata. The learner API also allows
`https://laxalab.com` and `https://www.laxalab.com` in CORS; the admin API only
allows `https://m.o2.h.laxalab.com`. The admin frontend's public site URL is
also set to that custom domain. Add `m.o2.h.laxalab.com` as a custom domain to
the `laxalab-web-admin` Render service and configure its DNS as Render directs;
the domain will not serve the admin UI until that verification is complete.
Do not replace browser-facing API URLs with Render's short internal service
hostnames. If you use another custom frontend domain, add its exact origin to
`CORS_ORIGINS` on the corresponding API and update
`NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_API_URL` on each frontend and
`FRONTEND_URL` on its matching API, then redeploy the frontends (Next.js embeds
`NEXT_PUBLIC_*` values during build). Configure any Google OAuth callback and
Stripe webhook URLs to the deployed service URLs as well.

### Error monitoring with Sentry

The backend and Next.js frontend support Sentry error reporting and sampled
performance tracing. Create Sentry projects for the backend and frontend, then
set `SENTRY_DSN` on both API services and `NEXT_PUBLIC_SENTRY_DSN` on both web
services. The public frontend DSN is designed to be included in the browser;
keep the backend DSN server-side. The SDKs stay disabled when their DSN is
unset.

Tracing defaults to 5% of transactions and can be adjusted with
`SENTRY_TRACES_SAMPLE_RATE` on the APIs and
`NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` on the web services. Request bodies,
cookies, headers, query strings, database parameters, and user identity are
excluded from Sentry events; session replay is not enabled.

For readable frontend stack traces, optionally set `SENTRY_AUTH_TOKEN`,
`SENTRY_ORG`, and `SENTRY_PROJECT` on both web services. These enable source-map
upload during the frontend build. Keep the auth token secret. Adding or changing
the public frontend DSN requires a frontend rebuild because Next.js embeds
`NEXT_PUBLIC_*` variables during build.

### Free-plan limitations

This Blueprint intentionally selects free plans because it is an evaluation
setup, not a production recommendation:

- Free web services sleep after 15 minutes without traffic and can take about a
  minute to wake. They have ephemeral disks; this project uses R2 for uploads
  so files do not depend on those disks.
- Render's free PostgreSQL database has a 1 GB limit, no backups, and expires
  30 days after creation. Upgrade it before expiry to keep the data; after the
  additional 14-day grace period Render deletes it.
- The free Redis-compatible Key Value instance is in-memory and can lose its
  cache/rate-limit data when it restarts. It is not application data, but do
  not use this plan as a production security boundary.
- Render free web services cannot send SMTP traffic on ports 465/587. Use an
  email provider/API or a supported port, or configure email later.
- Four web services, Redis, and the database share the workspace's free allowances.
  Review Render's current usage and pricing before leaving this as a live
  service.

The Blueprint creates an empty database. If you are moving an existing
deployment, first migrate the database and copy every referenced object from
the old `uploads/` tree into the R2 bucket using the same `uploads/...` keys.
Do not direct production traffic to the new APIs until that migration is
verified.

This repository is prepared for Render deployment, but the Blueprint must be
connected and launched from your Render account. Never paste Render or R2
credentials into chat or commit them to the repository.

### Create or reset the Render admin account

The Blueprint does not create login accounts. To provision only
`admin@laxalab.com`, run `npm run admin:bootstrap` from the repository root in
an interactive local terminal. The command prompts for Render's external
PostgreSQL URL and a new password without echoing either secret. If the account
already exists, it also prompts for Render's external Redis URL so the cached
identity can be invalidated. It changes no other accounts and does not print or
save the password.

Find the external URLs in the Render dashboard under the `laxalab-postgres`
and `laxalab-redis` resources. If external access is blocked, allow only your
current IP in the resource's IP allow list, then remove that rule after the
bootstrap completes. Do not run `npx prisma db seed` for this operation: that
seed handles five accounts.

The admin must sign in at the admin frontend, set a personal password, and
complete the required two-factor authentication setup. Use a new password;
never reuse credentials exposed in chat or local files.

---

## Target 2: Railway

Railway deploys from this GitHub repository. Three services:

| Service    | Build command        | Start command       | Env var                          |
|-----------|---------------------|--------------------|----------------------------------|
| Backend    | `npm install`        | `npm run build && node dist/main.js` | `DATABASE_URL`, `JWT_SECRET`, SMTP, etc. |
| Frontend   | `npm install`        | `npm run build && npm start` (Next standalone) | `NEXT_PUBLIC_API_URL` (no `/api` suffix) |
| Postgres   | (Railway managed)    | —                  | internal `DATABASE_URL` connection |

Backend variables (all on the backend service dashboard; SMTP settings are
required to deliver email-verification and password-reset links):

```
DATABASE_URL, JWT_SECRET, FRONTEND_URL, GOOGLE_CLIENT_ID,
GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL, SMTP_HOST, SMTP_PORT,
SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM, STRIPE_SECRET_KEY,
STRIPE_WEBHOOK_SECRET, ADMIN_EMAIL
```

Frontend variables:

```
NEXT_PUBLIC_API_URL=https://<your-railway-backend>/api   # no trailing /api stripped
NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_CURRENCY, NEXT_PUBLIC_GA4_ID, NEXT_PUBLIC_GTM_ID
```

> Note: the frontend build **bakes** `NEXT_PUBLIC_*` values into the bundle, so
> changing them requires a redeploy. In the Dockerfile the default
> `NEXT_PUBLIC_API_URL` already points at the real backend, so the build arg is
> only needed when the backend URL changes.

The migrations run automatically at backend container start (`prisma migrate deploy`).

### First-deploy assumption (no legacy data)

The `seatsTaken` column on `CourseOpening` (introduced with the
`20260925181018_webhook_events_and_seat_counter` migration) backfills itself
from existing non-rejected enrollments. The assumption is that this project has
**no legacy production data on first deploy**: a brand-new Railway Postgres is
created and `prisma migrate deploy` runs every migration including the backfill
against empty tables. If you ever import old data, re-run the backfill by
counting enrollments with `status NOT IN ('REJECTED','REVOKED')` per opening.

### Refund policy

- A refund is **only** possible from a `PAID` payment (admin/finance only;
  students cancel `PENDING` payments themselves).
- `refund()` marks the payment `REFUNDED`, sets `refundedAt`, **revokes** the
  linked enrollment (`REVOKED`), **releases the claimed seat**, and writes an
  audit log row — all in one transaction. A refunded enrollment never holds a
  seat and never appears as an active course member.
- Stripe webhook over-capacity settlement **auto-refunds**: if a paid
  PaymentIntent can't claim a seat because the opening filled up between
  checkout and settlement, the payment is refunded automatically, the student is
  emailed, and the opening seat counter is never touched.
- Financial records are **never deleted**; a refund keeps the original `Payment`
  row (status `REFUNDED`) for ledger integrity.

### Certificate issuance policy

- Ending a course **does not issue certificates automatically**. Instructors
  and admins manually select which approved students receive a certificate once
  the opening is `ENDED` (requires `course.certificateIssued = true`).
- Staff gate: ADMIN / COURSE_MANAGER anywhere; INSTRUCTORS only for openings
  they teach. `revoke()`/`reissue()` are admin/course-manager only.
- Everything is audit-logged; students get an in-app + email notification.

### Stripe webhook integrity

- The webhook is **idempotent**: each Stripe event id is recorded in a
  `WebhookEvent` table and duplicates short-circuit.
- The PaymentIntent is verified (`providerRef`, exact amount, currency) before
  any settlement; mismatches are logged and ignored (no enrollment granted).
- Settlement (payment `PAID` + enrollment `APPROVED` + seat claim + coupon
  usage + `WebhookEvent`) happens in a **single atomic transaction**.

---

## Target 3: Self-hosted Docker Compose

`docker-compose.prod.yml` runs: **Postgres 15**, **NestJS backend**, **Next.js
frontend**, **nginx** (HTTP→HTTPS, TLS, 100MB uploads), and **certbot** (Let's
Encrypt, auto-renewal).

### Requirements

- Docker + Docker Compose v2
- A domain `A`/`AAAA` record → your server's public IP (ports 80 & 443 open)

### 1. Configure the environment

```bash
cp .env.production.example .env.production
# then edit .env.production:
#  - DB_PASS, JWT_SECRET: strong random values
#  - DOMAIN: your real domain
#  - CERTBOT_EMAIL: your email (for certificate expiry notices)
#  - FRONTEND_URL / NEXT_PUBLIC_API_URL: https://yourdomain.com / https://yourdomain.com/api
#  - SMTP_*, GOOGLE_*, STRIPE_* as needed
```

`.env.production` is gitignored and never committed.

### 2. Start the stack

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

> `--env-file .env.production` is **required**: Compose interpolates `${DB_USER}`,
> `${DOMAIN}`, `DATABASE_URL`, etc. from it, and the services read the same file
> via `env_file:`, so one file drives the whole stack.

This starts `db`, `backend`, `frontend`, and `nginx`; the backend runs
`prisma migrate deploy` on startup. nginx serves HTTP 80 and redirects to HTTPS.

### 3. Issuing the TLS certificate (first run only)

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up --build certbot
```

`certbot` obtains a certificate for `DOMAIN` and `www.DOMAIN` via the webroot
challenge (nginx serves `/.well-known/acme-challenge/` on port 80), then keeps
renewing automatically in the background. After issuance nginx picks up the
certificates at `/etc/letsencrypt/live/${DOMAIN}/` on its next reload.

### 4. Verify

```bash
curl -I https://yourdomain.com          # expect 301/200 + TLS
curl -I https://yourdomain.com/api/health  # backend liveness
```

### Environment mapping (Compose => service)

| `.env.production` key      | Used by                                            |
|----------------------------|----------------------------------------------------|
| `DB_USER`/`DB_PASS`/`DB_NAME` | Postgres + backend `DATABASE_URL`               |
| `PORT`                     | backend (must stay `3000`)                         |
| `NEXT_PUBLIC_API_URL`      | frontend build arg (baked into bundle)             |
| `DOMAIN`, `CERTBOT_EMAIL`  | nginx `server_name` + certbot certificate          |
| all others                 | backend runtime (JWT, SMTP, Google, Stripe, ...)   |

### Backups

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$DB_USER" "$DB_NAME" > backup.sql
```

The `uploads` volume (`uploads_data`) holds user-uploaded files — include it in
your backup automation.