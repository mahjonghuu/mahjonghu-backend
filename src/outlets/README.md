# Outlets Module

Owns outlet CRUD, operational status, and archive rules for the local dashboard API.

## API

- `GET /outlets` lists non-archived outlets with live table and in-progress booking counts.
- `POST /outlets` creates an outlet. Names, city, and address are trimmed; active names must be unique.
- `PATCH /outlets/:id` updates outlet fields. Deactivation is rejected while a booking is in progress.
- `DELETE /outlets/:id` archives the outlet and returns `204 No Content`. It returns `409 Conflict` while tables or booking history reference the outlet.

## Structure

- `outlets.controller.ts`: HTTP routes and UUID/body validation.
- `outlets.service.ts`: outlet queries, persistence, and business rules.
- `entities/outlet.entity.ts`: TypeORM mapping for the `outlets` table.
- `dto/`: create and update request validation.
- `outlets.service.spec.ts`: service unit tests for summary mapping, normalization, booking constraints, archive rules, and duplicate names.

All outlet routes require an active owner JWT in `Authorization: Bearer <token>`. Obtain a token from `POST /auth/login`; owner accounts are provisioned only by a trusted administrator.
