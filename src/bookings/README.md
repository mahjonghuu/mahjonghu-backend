# Bookings module

Provides public booking availability and dashboard booking records. Public pending bookings are created only as part of a DOKU checkout so payment and table holds remain linked:

- `GET /bookings/availability?outletId=<uuid>&startsAt=<ISO-8601>&durationHours=<integer>` returns available tables and current hourly IDR rates.
- `GET /bookings` lists persisted booking records with customer contact, outlet, table, time, amount, and status for the internal dashboard. It requires an active owner JWT in `Authorization: Bearer <token>`.

`POST /payments/doku/:environment/checkout` validates all selected sessions against current outlet, table, availability, and server-side prices; creates each booking and its payment record in one transaction; and then requests one aggregate DOKU Checkout. Each pending booking hold expires after 15 minutes. DOKU Checkout is also configured with a 15-minute payment expiry. If checkout creation fails or payment remains pending after the deadline, pending bookings and charges are expired. PostgreSQL's `bookings_no_overlap` exclusion constraint remains the concurrency-safe final guard.

The public DOKU notification endpoint verifies the DOKU HMAC signature, client ID, timestamp, invoice, and amount before applying a success transition. DOKU `FAILED` notifications are acknowledged but ignored so Checkout customers may retry another payment method. Successful payment notifications are idempotent. If the payment succeeds after the hold was released or the table was rebooked, payment is recorded as succeeded and the public result page flags the reservation for manual review rather than silently confirming a conflicting booking.

Public availability and checkout creation do not require dashboard authentication. The internal booking list is owner-protected because it contains customer contact details.
