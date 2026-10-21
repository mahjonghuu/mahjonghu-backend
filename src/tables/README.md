# Tables Module

Owns mahjong table management for the local dashboard API. Occupancy is derived from in-progress bookings and is not stored as a manually editable table status.

## API

- `GET /tables` lists non-archived tables belonging to non-archived outlets. `GET /tables/public` exposes tables only for accessible active outlets. Status is `Digunakan` for an in-progress booking, `Perawatan` for a maintenance condition, and otherwise `Tersedia`. Pricing comes from the outlet, not the table.
- `POST /tables` creates a table for an active outlet; every table in that outlet uses the same base rate and duration thresholds configured through `/outlets`.
- `PATCH /tables/:id` updates the name and available/maintenance condition. Outlet assignment cannot be changed.
- `DELETE /tables/:id` archives a table and returns `204 No Content`. It returns `409 Conflict` if any booking history references the table.

Table management does not accept pricing fields. The owner edits the shared price schedule through `PATCH /outlets/:id`; checkout uses the current outlet rate and saves the applied effective hourly rate and total on each booking.

## Structure

- `tables.controller.ts`: HTTP routes and UUID/body validation.
- `tables.service.ts`: table queries, persistence, and booking-derived status rules.
- `entities/table.entity.ts`: TypeORM mapping for the `mahjong_tables` table.
- `dto/`: create and update request validation.
- `tables.service.spec.ts`: unit test for status precedence and table management.

`GET /tables/public` is available for public outlets and customers granted access to private outlets. Table management routes require an active owner JWT in `Authorization: Bearer <token>`. Obtain a token from `POST /auth/login`; owner accounts are provisioned only by a trusted administrator.
