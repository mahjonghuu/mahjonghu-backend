# Outlets Module

Owns owner outlet CRUD, visibility, and per-customer access grants. Existing outlets remain public after migration; new outlets default to public.

## API

- `GET /outlets` lists non-archived outlets with live counts and visibility; `GET /outlets/public` includes public outlets and private outlets granted to the current customer.
- `POST /outlets` creates an outlet, optionally with `visibility: "private"`. Names, city, and address are trimmed; active names must be unique.
- `PATCH /outlets/:id` updates fields including visibility. Deactivation is rejected while a booking is in progress.
- `DELETE /outlets/:id` archives the outlet and returns `204 No Content`. It returns `409 Conflict` while tables or booking history reference the outlet.
- `GET /outlets/:id/access` lists grants. `POST /outlets/:id/access` accepts `{ "email": "...", "expiresAt": "..." }` (expiry optional); it creates a customer invitation when necessary. `DELETE /outlets/:id/access/:userId` revokes immediately.

## Structure

- `outlets.controller.ts`: HTTP routes and UUID/body validation.
- `outlets.service.ts`: outlet queries, persistence, and business rules.
- `entities/outlet.entity.ts`: TypeORM mapping for the `outlets` table.
- `dto/`: create and update request validation.
- `outlets.service.spec.ts`: service unit tests for summary mapping, normalization, booking constraints, archive rules, and duplicate names.

Owner management and grant routes require an owner JWT; only `GET /outlets/public` accepts optional customer login. A private grant is valid only while the customer is active and its expiry has not passed. Guest companions do not need grants.
