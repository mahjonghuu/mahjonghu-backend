# MahjongHu Backend

NestJS API for public booking flows and internal owner operations. PostgreSQL is accessed through TypeORM; `synchronize` is disabled and schema changes use explicit migrations.

## Setup

```bash
npm install
cp .env.example .env
```

Configure `DATABASE_URL`, `WEB_ORIGIN`, `JWT_SECRET`, the DOKU credentials, and public callback URLs in `.env`. Generate a unique random `JWT_SECRET` of at least 32 characters and keep it private. Never commit `.env` or share its secret. The API listens on `127.0.0.1` by default and uses port `3001`.

Apply migrations explicitly after confirming the target database:

```bash
npm run migration:show
npm run migration:run
```

The single outlet-pricing migration moves each existing per-table hourly rate to its outlet and creates empty outlet-level duration tiers. It refuses to run if tables within the same outlet have different base rates, rather than silently repricing bookings. Before deployment, inspect and reconcile any such outlets in the target database, back it up, then apply migrations. Outlets with no tables start with a Rp75,000 one-hour rate. Previously persisted bookings keep their original rates and totals.

Identify outlets that need reconciliation with a read-only query against the pre-migration schema:

```sql
SELECT outlet_id, COUNT(DISTINCT hourly_rate_idr) AS distinct_prices
FROM mahjong_tables
GROUP BY outlet_id
HAVING COUNT(DISTINCT hourly_rate_idr) > 1;
```

Set one intended hourly rate for every table in each returned outlet before applying the outlet-pricing migration. This is a one-time data reconciliation; subsequent pricing edits and duration tiers are managed only on the outlet.

The DOKU payment migration creates payment sessions and links one aggregate checkout to its held bookings. Configure separate credentials:

- Sandbox: `DOKU_DEV_CLIENT_ID`, `DOKU_DEV_SECRET_KEY`
- Production: `DOKU_PROD_CLIENT_ID`, `DOKU_PROD_SECRET_KEY`
- Public browser return origin: `WEB_PUBLIC_URL`
- Public backend origin for DOKU HTTP notifications: `BACKEND_PUBLIC_URL`

The payment notification URLs are `/payments/doku/dev/notification` and `/payments/doku/prod/notification`. Configure each URL in the corresponding DOKU merchant environment, or set `BACKEND_PUBLIC_URL` so each checkout overrides the merchant notification URL. The frontend selects sandbox by default; set `NEXT_PUBLIC_DOKU_ENV=prod` at build time to use production credentials.

The migrations create the initial booking schema, add nullable `users.password_hash`, and add DOKU payment sessions; existing accounts remain unable to log in until provisioned. There is no public registration or owner-promotion endpoint. Create an owner through a trusted server/database administrator only. Generate a bcrypt hash with the backend dependency, then insert/update an owner record using a UUID `auth_subject` and normalized email:

```bash
read -s -p 'Owner password: ' OWNER_PASSWORD
printf '\n'
printf '%s' "$OWNER_PASSWORD" | node --input-type=module -e 'import { hash } from "bcryptjs"; let password = ""; for await (const chunk of process.stdin) password += chunk; console.log(await hash(password, 12))'
unset OWNER_PASSWORD
```

Use the generated hash as the `password_hash` value in a parameterized administrative SQL statement; set `role = 'owner'`, `is_active = true`, and `auth_subject` to a unique trusted identifier. Never send passwords or hashes in public API requests or commit them to source control.

For a new account, use a parameterized statement from a trusted administrative client:

```sql
INSERT INTO users (auth_subject, email, password_hash, role, is_active)
VALUES ($1, lower(btrim($2)), $3, 'owner', true);
```

## Image storage

Outlet photos and advertisement images share the generic `SupabaseImageStorage`
provider, which uses the Supabase Storage REST API, not PostgreSQL binary or
base64 storage. Set these **backend-only** variables locally and in each Vercel
environment that accepts image changes:

- `SUPABASE_URL`: the project's HTTPS origin, such as
  `https://your-project.supabase.co` (not the database/pooler URL).
- `SUPABASE_SERVICE_ROLE_KEY`: the project's server-only service-role key.
  Never commit it, send it to browsers, or use a `NEXT_PUBLIC_` variable.
- `SUPABASE_OUTLET_PHOTOS_BUCKET`: optional bucket name, default `outlet-photos`.
- `SUPABASE_ADVERTISEMENT_IMAGES_BUCKET`: optional bucket name, default
  `advertisement-images`.

In each environment, manually create both configured buckets in the Supabase
dashboard as **public**, set each maximum file size to **524288 bytes (512 KiB)**,
and allow only `image/jpeg`, `image/png`, and `image/webp`. Do not add anonymous
or browser write/delete policies: the backend uses its service-role key for
these operations after owner authentication on the JSON mutation endpoints.
Use separate projects/buckets and credentials for Preview and Production.

The browser still resizes/compresses photos and sends a raster base64 data URL
in the JSON `photo` field. The backend checks canonical base64, decoded size,
and JPEG/PNG/WebP signatures before uploading decoded bytes under
`outlets/<random-uuid>.jpg|png|webp`. The existing `outlets.photo` column stores
the resulting public object URL; no new base64 is persisted. Responses expose
that URL or `null`, not a signed URL. Missing/invalid configuration, network
errors, or unsuccessful storage responses produce a sanitized HTTP 503 when
uploading an image; applications without image changes need no storage credentials.
Only canonical generated object URLs in the configured origin/bucket can be
deleted by the storage adapter.
New uploads are removed if the database write fails. Old objects are deleted
only after a successful replacement, removal, or archive. Cleanup failures log
a warning without failing a committed database write; the leftover object may
need manual removal.


**Public bucket means public photos, including photos for private outlets.**
Anyone who knows a photo URL can fetch it without logging in; outlet access
controls do not protect those image bytes. Do not upload sensitive images.
Changing an outlet's visibility does not make its existing photo private.

For a local integration smoke check only, `SUPABASE_URL` may use HTTP on
`localhost`, `127.0.0.1`, or `::1`; remote endpoints must use HTTPS. Complete
bucket setup and provide real credentials before attempting a live upload,
public fetch, and removal check.

## Scheduled advertisements

Apply the `AddAdvertisements` database migration using the standard
`npm run migration:run` deployment step described in Setup, after confirming the
target database. It creates the advertisement table and schedule constraints;
there is no existing-data backfill. Provision the advertisement bucket in every
new environment using [Image storage](#image-storage) above. Advertisement
uploads use the same backend-only `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` as outlet photos; the outlet bucket configuration
remains unchanged.

- `GET /advertisements` lists all advertisements for an authenticated owner.
- `POST /advertisements` creates an advertisement with JSON fields `title`,
  `image`, `startsOn`, and `endsOn`, all required.
- `PATCH /advertisements/:id` partially updates those same fields. Omit `image`
  to preserve the current image; supplying it replaces the image. An empty or
  `null` image is not a way to remove it.
- `DELETE /advertisements/:id` permanently deletes the advertisement and returns
  `204 No Content`.
- `GET /advertisements/public` requires no authentication and returns only
  currently active advertisements. Both list endpoints send
  `Cache-Control: no-store`.

Owner routes require a valid owner JWT via `Authorization: Bearer <token>` or
the `ownerToken` cookie; customer JWTs are not accepted. As with outlet
mutations, requests carrying the owner cookie must send an `Origin` exactly
matching `WEB_ORIGIN` for POST, PATCH, and DELETE (including when a bearer token
is also supplied). Browser requests use the credentialed CORS and same-site
cookie rules described under authentication below.

`title` is trimmed and must contain 1–80 characters. For create, `image` must
contain the browser-resized/compressed JPEG, PNG, or WebP base64 data URL, not an
existing URL. The shared image validation and 512 KiB decoded-size limit above
also apply to replacements. Uploaded objects use
`advertisements/<random-uuid>.jpg|png|webp`; only their public URLs are stored.
Create, update, and list responses expose `id`, `title`, `imageUrl`, `startsOn`,
`endsOn`, and derived `status` (the upload input is `image`, not `imageUrl`).

`startsOn` and `endsOn` must be real calendar dates in strict `YYYY-MM-DD`
format, without a time or timezone suffix. `startsOn` must not be after
`endsOn`; a same-day campaign is valid. Schedules include both dates and are
evaluated using the server's current **Asia/Jakarta** calendar date:
`scheduled` before `startsOn`, `active` from `startsOn` through `endsOn`, and
`expired` after `endsOn`. Partial schedule edits are checked against the retained
other date. Status is derived, not an editable JSON field.

Failed database writes trigger cleanup of newly uploaded images. Replaced
images and images belonging to deleted advertisements are removed only after
the database transaction commits. Cleanup failures emit a sanitized warning
without URLs, credentials, image bytes, or provider errors and do not fail the
committed mutation; leftover objects may require manual removal.

**Campaign dates restrict public API discovery, not access to public files.**
Anyone who knows an image URL can fetch it before the campaign starts or after
it expires. Expiration does not delete the row or image. Delete the advertisement
to remove its row and attempt Storage cleanup; do not upload sensitive images.

## Deploy to Vercel

Create a separate Vercel project with **Root Directory** set to
`mahjonghu-backend` (not the repository root). Vercel detects NestJS from
`src/main.ts`; `vercel.json` builds the app, runs pending TypeORM migrations,
and only then bundles the function. Function duration uses the Vercel project default.
The PostgreSQL driver is imported explicitly by `AppModule` so the Vercel
function bundle includes `pg`; keep it in production dependencies.
Keep `bootstrap()` non-blocking at module scope: Vercel must finish importing
the NestJS entrypoint while the application initializes.
If compilation or migration fails, the deployment fails without replacing
the currently serving deployment. Do not set an output directory or add an
`api/` shim.

Set the backend environment variables in Vercel Project Settings:
`DATABASE_URL` (PostgreSQL transaction pooler), `JWT_SECRET`, `WEB_ORIGIN`
(exact HTTPS origin of the web app), `WEB_PUBLIC_URL` (web app origin),
`BACKEND_PUBLIC_URL` (this backend's public origin), and `OWNER_COOKIE_DOMAIN`
(shared parent domain for the web app and API; set `mahjonghuu.com` when the
dashboard is at `mahjonghuu.com` and the API at `api.mahjonghuu.com`).
Set the DOKU credentials for the checkout environments in use, plus
`RESEND_API_KEY` and `EMAIL_FROM` if customer email login is enabled.
Do not upload `.env` to Vercel. Build
migrations require a database connection and permission for the existing
migrations (including `btree_gist`); the `migration:deploy` script consumes
the already-built `dist` output, so no second build runs.

**Preview and Production must use separate `DATABASE_URL` values.** Every
Vercel build runs pending migrations against its configured database,
including Preview deployments; sharing the Production URL lets Preview
builds change the Production schema. Back up the target database and review
new migrations before deployment. Use backward-compatible schema changes:
the old deployment can still serve requests after a migration has applied,
even if the new build later fails. TypeORM records completed migrations;
already-applied migrations are not rerun.

Deploy via the Vercel dashboard or from this directory with Vercel CLI
48.4.0 or later (`vercel` for a preview, `vercel --prod` for production).
Use same-site HTTPS domains for the web and API (for example,
`booking.example.com` and `api.example.com`): owner/customer cookies are
`SameSite=Strict`, so two unrelated `*.vercel.app` project hosts cannot
support authenticated browser requests. Set `OWNER_COOKIE_DOMAIN=example.com`
when the dashboard and API use different subdomains: the dashboard proxy must
receive the owner cookie as well as the API. Without it, successful login
redirects back to `/dashboard/login`. Leave it unset for a same-host or local
setup. Configure `NEXT_PUBLIC_API_URL` on the frontend to the backend origin
and register the deployed DOKU
notification URLs. Vercel functions do not run continuously; don't rely on
the in-process expiry timer as a scheduled job. Availability and lookup
already treat elapsed pending holds as expired, while status checks expire
overdue payment sessions on access.

### Supabase activity cron

`vercel.json` schedules `GET /cron/supabase-keep-alive` with `0 0 */5 * *`.
This is a UTC day-of-month schedule: days 1, 6, 11, 16, 21, 26, and 31 when
present, nominally at 00:00 UTC (07:00 Jakarta). The gap is at most five days;
it can be shorter across month boundaries, rather than a rolling 120-hour timer.
Vercel runs scheduled cron requests against Production deployments, not local
development or Preview deployments.

Before deploying, generate a backend-only secret with `openssl rand -hex 32`
and set it as `CRON_SECRET` in the backend Vercel project's Production environment,
then redeploy. Never add it to the frontend or a `NEXT_PUBLIC_*` variable.
[Vercel automatically sends the secret as a bearer header](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
Missing configuration, missing authorization, and incorrect tokens return `401`
without querying the database.

The authorized endpoint executes `SELECT id FROM outlets LIMIT 1` through the
existing `DATABASE_URL` connection. It reads at most one row, makes no writes,
returns only `{"ok":true}`, and disables response caching. An empty outlet table
is valid; a failed query produces a failed HTTP response rather than false success.
No additional Supabase Storage key, service-role key, or Nest scheduler is needed.

After deployment, inspect **Settings → Cron Jobs** in the backend Vercel project
and trigger the job manually to check its runtime logs. For a local smoke check,
set `CRON_SECRET` in the backend environment, start the API, and run:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3001/cron/supabase-keep-alive
```

This creates periodic database activity, not a guarantee against Supabase pausing.
It cannot resume an already paused project; resume that project in Supabase
before relying on scheduled queries. Monitor failed invocations and check the
current Supabase plan policy if uninterrupted availability is required.

## Authentication and authorization

- `POST /auth/login` accepts `{ "email": "owner@example.com", "password": "..." }`. For active owners with valid bcrypt credentials, it sets an eight-hour `HttpOnly`, `SameSite=Strict` `ownerToken` cookie and returns the user profile. Set `OWNER_COOKIE_DOMAIN` to the shared parent domain if the dashboard and API are on separate hosts; logout clears the cookie with the same scope. Tokens are not exposed in the JSON response. Invalid credentials and non-owner accounts receive the same `401` response.
- `POST /auth/logout` clears the session cookie.
- `GET /auth/me` validates the JWT cookie or `Authorization: Bearer <token>` (used by the Next.js proxy).
- `POST /auth/customer/request-code` sends a six-digit single-use code through Resend only when the active customer email has an unexpired grant to an active, non-archived outlet. Emails without eligible outlet access receive `403` with `Email tidak terdaftar.` and no challenge or email is created. `RESEND_API_KEY` and `EMAIL_FROM` are required; codes expire after ten minutes. PostgreSQL enforces per-email cooldown and hourly limits for eligible addresses, per-IP hourly limits for all requests, and five verification attempts.
- `POST /auth/customer/verify-code` accepts `{ "email": "...", "code": "123456" }`, consumes the code atomically and sets an eight-hour `HttpOnly` `customerToken` cookie. `GET /auth/customer/me` returns `{ authenticated, user }`; `POST /auth/customer/logout` clears that cookie. Customer JWTs cannot authorize owner routes, and owner JWTs cannot authorize customer-only access.
- `GET /outlets/public` lists active, non-archived public outlets plus private outlets granted to the signed-in customer. `GET /outlets` and outlet mutations require an owner JWT.
- `GET /tables/public` lists tables belonging only to those accessible active outlets. `GET /tables` and table mutations require an owner JWT.
- Role authorization is enforced by the backend from verified JWT claims. The Next.js `proxy.ts` also asks the backend to validate the session before serving dashboard routes; backend API guards remain the authorization boundary.

Browser requests use credentialed CORS from the configured `WEB_ORIGIN`. The web app and API must be same-site for the strict cookie policy; cookie-authenticated mutations also require the exact configured origin. JWT signing and verification require `JWT_SECRET`; the application refuses to start without it.

## Private outlets and customer access

Existing outlets remain public after the access migration. Owners can mark an
outlet private independently of its operational status and grant customer access
by email in the outlet workspace. A grant may expire; revocation prevents new
checkouts but does not cancel an existing booking or payment.

Customer sign-in uses email one-time codes through `POST /auth/customer/request-code`
and `POST /auth/customer/verify-code`. Configure `RESEND_API_KEY` and a verified
`EMAIL_FROM` sender for Resend delivery; without them, codes cannot be issued.
Resend receives a responsive, self-contained HTML email with the six-digit code,
ten-minute expiry and anti-sharing guidance, plus an equivalent plain-text body
for mail clients that do not render HTML. No external image or link is required.
Only active customer addresses with a current owner-issued grant to an active
outlet receive a code; other addresses see `Email tidak terdaftar.` Customer
sessions use a separate HttpOnly `customerToken` cookie, never the dashboard
owner cookie.
No customer registration or owner promotion is exposed publicly.

Private outlet details, tables, availability, and checkout are available only
to a signed-in customer with an unexpired outlet grant. A member books for the
whole table; accompanying players do not need accounts. Public outlets retain
guest checkout. Backend checkout rechecks access before creating any hold.

## API and operation

- `GET /outlets` lists non-archived outlets. `POST /outlets`, `PATCH /outlets/:id`, and `DELETE /outlets/:id` manage outlets; archival is rejected if tables or booking history reference them. Every outlet has a base whole-IDR hourly `rate` and a single `pricingMode` (`duration` by default for existing/new outlets, or `happy_hour`). Duration mode uses optional ascending `rateTiers` of `{ durationHours, rate }` thresholds (2–10 hours): the greatest eligible hourly tier prices the entire booking. Happy-hour mode requires `happyHour: { days: [1, 3, 5], startHour: 16, endHour: 19, rate: 60000 }` (unique ISO weekdays Monday=1 through Sunday=7; whole-hour window with 0–23 start and 1–24 end). It charges each full booked hour at the configured rate only when that hour falls within a selected outlet-local weekday/window, and the base rate otherwise, including hours after midnight. Switching modes clears the inactive configuration; switching back requires a new happy-hour configuration. Checkout authoritatively sums each booking and snapshots its total into booking, payment, and DOKU session amounts.
- `GET /tables` lists non-archived tables with booking-derived occupancy. `POST /tables`, `PATCH /tables/:id`, and `DELETE /tables/:id` manage tables; occupancy cannot be set manually. All tables in an outlet use its shared rate schedule; table routes do not accept prices.
- `GET /bookings/availability` provides public slot discovery. All guest reservations are created together with a DOKU payment session through the checkout endpoints above; standalone unpaid `POST /bookings` is not exposed.
- Opening and closing hours are configured per outlet in whole hours (default 12:00–22:00); public discovery returns them, and checkout rejects sessions outside those hours. A closing hour earlier than opening (for example, 13:00–04:00) closes on the next calendar day; `closingHour: 0` means next-day midnight when opening is later, while `closingHour: 24` means same-day midnight. Equal opening and closing hours are invalid. Apply pending migrations before accepting overnight outlet updates so the database constraint matches the API.
- `POST /payments/doku/dev/checkout` creates one sandbox DOKU Checkout for all selected table sessions; `/prod/checkout` uses the separate production credentials. Each server-created booking hold and the DOKU checkout deadline use the provider's 15-minute expiry.
- `POST /payments/doku/:environment/notification` verifies signed DOKU payment notifications. `GET /payments/doku/status/:reference` exposes the current public payment/result details; the result page polls this endpoint until the payment is settled or expires.

CORS uses `WEB_ORIGIN` (default `http://localhost:3000`). Request logging records request IDs, method, path, status, and duration; request bodies and headers are not logged.

```bash
npm run dev
npm test
npm run build
```

To exercise the payment checkout locks and expiry/notification concurrency against PostgreSQL, use a dedicated test database. The test creates and removes its own schema and runs the payment migrations; the database user needs permission to create schemas and the `btree_gist` extension.

```bash
PAYMENTS_TEST_DATABASE_URL=postgres://user:password@localhost:5432/mahjonghu_test \
  npx vitest run src/payments/payments.service.pg.spec.ts
```
