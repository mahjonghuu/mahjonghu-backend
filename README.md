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
(exact HTTPS origin of the web app), `WEB_PUBLIC_URL` (web app origin), and
`BACKEND_PUBLIC_URL` (this backend's public origin). Set the DOKU credentials
for the checkout environments in use, plus `RESEND_API_KEY` and `EMAIL_FROM`
if customer email login is enabled. Do not upload `.env` to Vercel. Build
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
support authenticated browser requests. Configure `NEXT_PUBLIC_API_URL` on
the frontend to the backend origin and register the deployed DOKU
notification URLs. Vercel functions do not run continuously; don't rely on
the in-process expiry timer as a scheduled job. Availability and lookup
already treat elapsed pending holds as expired, while status checks expire
overdue payment sessions on access.

## Authentication and authorization

- `POST /auth/login` accepts `{ "email": "owner@example.com", "password": "..." }`. For active owners with valid bcrypt credentials, it sets an eight-hour `HttpOnly`, `SameSite=Strict` `ownerToken` cookie and returns the user profile. Tokens are not exposed in the JSON response. Invalid credentials and non-owner accounts receive the same `401` response.
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

- `GET /outlets` lists non-archived outlets. `POST /outlets`, `PATCH /outlets/:id`, and `DELETE /outlets/:id` manage outlets; archival is rejected if tables or booking history reference them.
- `GET /tables` lists non-archived tables with booking-derived occupancy. `POST /tables`, `PATCH /tables/:id`, and `DELETE /tables/:id` manage tables; occupancy cannot be set manually.
- `GET /bookings/availability` provides public slot discovery. All guest reservations are created together with a DOKU payment session through the checkout endpoints above; standalone unpaid `POST /bookings` is not exposed.
- Opening and closing hours are configured per outlet in whole hours (default 12:00–22:00); public discovery returns them, and checkout rejects sessions outside those hours.
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
