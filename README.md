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

## Authentication and authorization

- `POST /auth/login` accepts `{ "email": "owner@example.com", "password": "..." }`. For active owners with valid bcrypt credentials, it sets an eight-hour `HttpOnly`, `SameSite=Strict` `ownerToken` cookie and returns the user profile. Tokens are not exposed in the JSON response. Invalid credentials and non-owner accounts receive the same `401` response.
- `POST /auth/logout` clears the session cookie.
- `GET /auth/me` validates the JWT cookie or `Authorization: Bearer <token>` (used by the Next.js proxy).
- `GET /outlets/public` lists active, non-archived outlets for public discovery. `GET /outlets` and all outlet mutations require an owner JWT.
- `GET /tables/public` lists tables belonging to active, non-archived outlets. `GET /tables` and all table mutations require an owner JWT.
- Role authorization is enforced by the backend from verified JWT claims. The Next.js `proxy.ts` also asks the backend to validate the session before serving dashboard routes; backend API guards remain the authorization boundary.

Browser requests use credentialed CORS from the configured `WEB_ORIGIN`. The web app and API must be same-site for the strict cookie policy; cookie-authenticated mutations also require the exact configured origin. JWT signing and verification require `JWT_SECRET`; the application refuses to start without it.

## API and operation

- `GET /outlets` lists non-archived outlets. `POST /outlets`, `PATCH /outlets/:id`, and `DELETE /outlets/:id` manage outlets; archival is rejected if tables or booking history reference them.
- `GET /tables` lists non-archived tables with booking-derived occupancy. `POST /tables`, `PATCH /tables/:id`, and `DELETE /tables/:id` manage tables; occupancy cannot be set manually.
- `GET /bookings/availability` provides public slot discovery. All guest reservations are created together with a DOKU payment session through the checkout endpoints above; standalone unpaid `POST /bookings` is not exposed.
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
