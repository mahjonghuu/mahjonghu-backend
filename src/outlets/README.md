# Outlets Module

Owns owner outlet CRUD, visibility, and per-customer access grants. Existing outlets remain public after migration; new outlets default to public.

## API

- `GET /outlets` lists non-archived outlets with live counts, visibility, `rate`, `pricingMode`, `rateTiers`, and `happyHour`; `GET /outlets/public` returns the same pricing fields for discoverable outlets.
- `POST /outlets` creates an outlet, optionally with `visibility: "private"`. Names, city, and address are trimmed; active names must be unique. `rate` (whole IDR, 1–1,000,000,000) is required. Default `pricingMode: "duration"` uses optional ordered `rateTiers: [{ "durationHours": 2, "rate": 80000 }]` shared by every table.
- `pricingMode: "happy_hour"` instead requires `happyHour: { "days": [1, 3, 5], "startHour": 16, "endHour": 19, "rate": 60000 }`. Days are unique ISO weekdays (Monday=1 through Sunday=7); start is 0–23, end is 1–24 and later than start. Happy hour and nonempty duration tiers cannot coexist. `PATCH /outlets/:id` may update either schedule; omitting one retains it in its active mode. Switching modes clears the inactive schedule; switching back to happy hour requires sending its configuration again. `happyHour: null` is accepted for duration mode. Deactivation is rejected while a booking is in progress.
- `DELETE /outlets/:id` archives the outlet and returns `204 No Content`. It returns `409 Conflict` while tables or booking history reference the outlet.
- `GET /outlets/:id/access` lists grants. `POST /outlets/:id/access` accepts `{ "email": "...", "expiresAt": "..." }` (expiry optional); it creates a customer invitation when necessary. `DELETE /outlets/:id/access/:userId` revokes immediately.

A contiguous booking session uses the highest configured duration threshold at or below its length, or the one-hour base rate. The selected hourly rate applies to every hour in that session; unconfigured durations inherit the previous tier. For a base rate of Rp100,000/hour and a two-hour tier of Rp80,000/hour, one hour costs Rp100,000, two hours Rp160,000, and three hours Rp240,000. All tables within an outlet share this price schedule. Checkout determines the final amount on the server and saves the applied rate with each booking.

In happy-hour mode each full booked hour is priced at the happy-hour rate if its start falls on a selected outlet-local calendar weekday within `[startHour, endHour)`; all other hours use the base `rate`. The local day is recalculated after midnight even for an overnight booking. A session from 15:00–18:00 with a 16:00–19:00 happy hour pays one base hour plus two happy hours. Checkout snapshots its first applied hourly rate and the authoritative mixed total into the booking, its payment contribution, and the aggregate DOKU amount; subsequent outlet changes do not reprice existing bookings.

## Structure

- `outlets.controller.ts`: HTTP routes and UUID/body validation.
- `outlets.service.ts`: outlet queries, persistence, and business rules.
- `entities/outlet.entity.ts`: TypeORM mapping for the `outlets` table.
- `dto/`: create and update request validation.
- `outlets.service.spec.ts`: service unit tests for summary mapping, normalization, booking constraints, archive rules, and duplicate names.

Owner management and grant routes require an owner JWT; only `GET /outlets/public` accepts optional customer login. A private grant is valid only while the customer is active and its expiry has not passed. Guest companions do not need grants.
