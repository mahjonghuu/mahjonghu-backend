# Outlets Module

Owns owner outlet CRUD, visibility, and per-customer access grants. Existing outlets remain public after migration; new outlets default to public.

## API

- `GET /outlets` lists non-archived outlets with live counts, visibility, one-hour `rate`, and `rateTiers`; `GET /outlets/public` includes only public outlets and private outlets granted to the current customer, with the same pricing fields.
- `POST /outlets` creates an outlet, optionally with `visibility: "private"`. Names, city, and address are trimmed; active names must be unique. The required `rate` sets the one-hour hourly price; optional `rateTiers: [{ "durationHours": 2, "rate": 80000 }]` defines later hourly-price thresholds shared by every table in that outlet.
- `PATCH /outlets/:id` updates fields including visibility and pricing. Omitting `rateTiers` preserves the existing tiers; `[]` clears them. Deactivation is rejected while a booking is in progress.
- `DELETE /outlets/:id` archives the outlet and returns `204 No Content`. It returns `409 Conflict` while tables or booking history reference the outlet.
- `GET /outlets/:id/access` lists grants. `POST /outlets/:id/access` accepts `{ "email": "...", "expiresAt": "..." }` (expiry optional); it creates a customer invitation when necessary. `DELETE /outlets/:id/access/:userId` revokes immediately.

A contiguous booking session uses the highest configured duration threshold at or below its length, or the one-hour base rate. The selected hourly rate applies to every hour in that session; unconfigured durations inherit the previous tier. For a base rate of Rp100,000/hour and a two-hour tier of Rp80,000/hour, one hour costs Rp100,000, two hours Rp160,000, and three hours Rp240,000. All tables within an outlet share this price schedule. Checkout determines the final amount on the server and saves the applied rate with each booking.

## Structure

- `outlets.controller.ts`: HTTP routes and UUID/body validation.
- `outlets.service.ts`: outlet queries, persistence, and business rules.
- `entities/outlet.entity.ts`: TypeORM mapping for the `outlets` table.
- `dto/`: create and update request validation.
- `outlets.service.spec.ts`: service unit tests for summary mapping, normalization, booking constraints, archive rules, and duplicate names.

Owner management and grant routes require an owner JWT; only `GET /outlets/public` accepts optional customer login. A private grant is valid only while the customer is active and its expiry has not passed. Guest companions do not need grants.
