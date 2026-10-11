# Bookings module

Provides public booking availability and guest booking holds, plus an internal dashboard list:

- `GET /bookings/availability?outletId=<uuid>&startsAt=<ISO-8601>&durationHours=<integer>` returns available tables and current hourly IDR rates.
- `POST /bookings` accepts `outletId`, `tableId`, `customerName`, `customerContact`, `startsAt`, and `durationHours`. Pricing and end time are calculated by the service; clients cannot set status, user identity, or price.
- `GET /bookings` lists persisted booking records with customer contact, outlet, table, time, amount, and status for the internal dashboard. It requires an active owner JWT in `Authorization: Bearer <token>`.

Creation checks that the outlet and table are active and bookable, expires elapsed pending holds for the selected table, and inserts a pending 15-minute hold in one transaction. PostgreSQL's `bookings_no_overlap` exclusion constraint remains the concurrency-safe final guard; overlapping active bookings return HTTP 409. Public booking responses omit customer contact details.

Public availability and booking creation do not require dashboard authentication. The internal booking list is owner-protected because it contains customer contact details. Owner login is provided by `POST /auth/login`; apply the user schema migrations and provision owner credentials through a trusted administrator before use. This module does not implement payments, booking confirmation, or customer accounts.
