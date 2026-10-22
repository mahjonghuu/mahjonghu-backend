import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { OutletAccessService } from '../outlets/outlet-access.service.js';
import { TableEntity } from '../tables/entities/table.entity.js';
import { CreateDokuCheckoutDto } from './dto/create-doku-checkout.dto.js';
import {
  DokuClientService,
  type DokuEnvironment,
} from './doku-client.service.js';
import { PaymentSessionEntity } from './entities/payment-session.entity.js';

type DokuNotification = {
  order?: { invoice_number?: unknown; amount?: unknown };
  transaction?: { status?: unknown; date?: unknown };
};

const HOLD_MILLISECONDS = 15 * 60_000;
const ISO_DAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Calculates the immutable rate snapshot and amount from the locked outlet configuration. */
export function bookingPrice(
  outlet: Pick<
    OutletEntity,
    'timezone' | 'hourlyRateIdr' | 'rateTiers' | 'pricingMode' | 'happyHour'
  >,
  startsAt: Date,
  durationHours: number,
): { hourlyRateIdr: string; amount: bigint } {
  if (outlet.pricingMode === 'happy_hour' && outlet.happyHour) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: outlet.timezone,
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    let firstHourRate = '';
    let amount = 0n;
    for (let index = 0; index < durationHours; index += 1) {
      const parts = formatter.formatToParts(
        new Date(startsAt.getTime() + index * 3_600_000),
      );
      const weekday =
        ISO_DAY[parts.find((part) => part.type === 'weekday')!.value];
      const hour = Number(parts.find((part) => part.type === 'hour')!.value);
      const { days, startHour, endHour, rate } = outlet.happyHour;
      const appliedRate =
        days.includes(weekday) && hour >= startHour && hour < endHour
          ? String(rate)
          : outlet.hourlyRateIdr;
      if (index === 0) firstHourRate = appliedRate;
      amount += BigInt(appliedRate);
    }
    return { hourlyRateIdr: firstHourRate, amount };
  }
  let hourlyRateIdr = outlet.hourlyRateIdr;
  for (const tier of outlet.rateTiers) {
    if (tier.durationHours > durationHours) break;
    hourlyRateIdr = String(tier.rate);
  }
  return {
    hourlyRateIdr,
    amount: BigInt(hourlyRateIdr) * BigInt(durationHours),
  };
}

/** Owns multi-table holds, DOKU Checkout sessions, and verified payment transitions. */
@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private expiryTimer!: NodeJS.Timeout;

  constructor(
    @InjectRepository(PaymentSessionEntity)
    private readonly sessions: Repository<PaymentSessionEntity>,
    private readonly dataSource: DataSource,
    private readonly doku: DokuClientService,
    private readonly outletAccess: OutletAccessService,
    private readonly config: ConfigService,
  ) {}

  /** Schedules cleanup so abandoned holds transition out of pending after expiry. */
  onModuleInit(): void {
    this.expiryTimer = setInterval(() => {
      void this.expireOverdueSessions().catch((error: unknown) => {
        this.logger.error('Failed to expire overdue DOKU sessions.', error);
      });
    }, 5_000);
    this.expiryTimer.unref();
  }

  /** Stops the expiry task when the Nest application shuts down. */
  onModuleDestroy(): void {
    clearInterval(this.expiryTimer);
  }

  /** Creates server-priced booking holds and one aggregate DOKU Checkout. */
  async createCheckout(
    environment: DokuEnvironment,
    dto: CreateDokuCheckoutDto,
    userId: string | null = null,
  ) {
    const customerName = dto.customerName.trim();
    const customerPhone = dto.customerPhone.trim();
    const customerEmail = dto.customerEmail.trim().toLowerCase();
    if (!customerName || !customerPhone || !customerEmail) {
      throw new BadRequestException(
        'Nama, nomor telepon, dan email wajib diisi.',
      );
    }

    const invoiceNumber = `MH${randomUUID().replaceAll('-', '').slice(0, 28).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + HOLD_MILLISECONDS);
    let checkoutSession: PaymentSessionEntity;

    try {
      checkoutSession = await this.dataSource.transaction(async (manager) => {
        const tableRepository = manager.getRepository(TableEntity);
        const outletRepository = manager.getRepository(OutletEntity);
        const sessionRepository = manager.getRepository(PaymentSessionEntity);
        const outlet = await outletRepository.findOne({
          where: { id: dto.outletId, isActive: true, archivedAt: IsNull() },
          lock: { mode: 'pessimistic_read' },
        });
        if (!outlet) throw new NotFoundException('Outlet tidak ditemukan.');
        if (!(await this.outletAccess.allowed(outlet.id, userId))) {
          throw new NotFoundException('Outlet tidak ditemukan.');
        }
        this.validateRequestedSessions(
          dto,
          outlet.timezone,
          outlet.openingHour,
          outlet.closingHour,
        );

        const requestedTableIds = [
          ...new Set(dto.sessions.map((item) => item.tableId)),
        ].sort();
        const tables = await tableRepository
          .createQueryBuilder('table')
          .where('table.id IN (:...requestedTableIds)', { requestedTableIds })
          .andWhere('table.outletId = :outletId', { outletId: dto.outletId })
          .andWhere('table.condition = :condition', { condition: 'available' })
          .andWhere('table.archivedAt IS NULL')
          .orderBy('table.id', 'ASC')
          .setLock('pessimistic_write')
          .getMany();
        if (tables.length !== requestedTableIds.length) {
          throw new ConflictException('Meja yang dipilih tidak tersedia.');
        }
        const tableById = new Map(tables.map((table) => [table.id, table]));

        if (requestedTableIds.length > 0) {
          await manager.query(
            `UPDATE bookings SET status = 'expired', updated_at = CURRENT_TIMESTAMP
             WHERE table_id = ANY($1::uuid[]) AND status = 'pending' AND hold_expires_at <= CURRENT_TIMESTAMP`,
            [requestedTableIds],
          );
        }

        const conflictValues = dto.sessions.map((_, index) => {
          const offset = index * 3;
          return `($${offset + 1}::uuid, $${offset + 2}::timestamptz, $${offset + 3}::timestamptz)`;
        });
        const conflictParameters = dto.sessions.flatMap((requested) => {
          const start = new Date(requested.startsAt);
          return [
            requested.tableId,
            start,
            new Date(start.getTime() + requested.durationHours * 3_600_000),
          ];
        });
        const conflicts = (await manager.query(
          `SELECT booking.id
           FROM bookings booking
           JOIN (VALUES ${conflictValues.join(', ')}) AS requested(table_id, starts_at, ends_at)
             ON booking.table_id = requested.table_id
             AND booking.starts_at < requested.ends_at
             AND booking.ends_at > requested.starts_at
           WHERE booking.status IN ('pending', 'confirmed', 'in_progress')
           FOR UPDATE OF booking`,
          conflictParameters,
        )) as { id: string }[];
        if (conflicts.length > 0) {
          throw new ConflictException(
            'Slot yang dipilih sudah tidak tersedia.',
          );
        }
        for (let index = 0; index < dto.sessions.length; index += 1) {
          const requested = dto.sessions[index];
          const startsAt = new Date(requested.startsAt);
          for (
            let previousIndex = 0;
            previousIndex < index;
            previousIndex += 1
          ) {
            const previous = dto.sessions[previousIndex];
            const previousStart = new Date(previous.startsAt).getTime();
            const previousEnd =
              previousStart + previous.durationHours * 3_600_000;
            if (
              previous.tableId === requested.tableId &&
              startsAt.getTime() < previousEnd &&
              startsAt.getTime() + requested.durationHours * 3_600_000 >
                previousStart
            ) {
              throw new BadRequestException(
                'Pilihan meja berisi jadwal yang tumpang tindih.',
              );
            }
          }
        }

        const savedSession = await sessionRepository.save(
          sessionRepository.create({
            invoiceNumber,
            environment,
            status: 'pending',
            customerName,
            customerPhone,
            customerEmail,
            amountIdr: '1',
            checkoutUrl: null,
            dokuSessionId: null,
            expiresAt,
            notificationRequestId: null,
            settledAt: null,
            reservationNeedsReview: false,
          }),
        );

        let totalAmount = 0n;
        const bookingRows = dto.sessions.map((requested) => {
          const table = tableById.get(requested.tableId)!;
          const startsAt = new Date(requested.startsAt);
          const { hourlyRateIdr, amount } = bookingPrice(
            outlet,
            startsAt,
            requested.durationHours,
          );
          totalAmount += amount;
          return {
            reference: `MH${randomUUID().replaceAll('-', '').toUpperCase()}`,
            outletId: dto.outletId,
            tableId: table.id,
            userId,
            customerName,
            customerContact: customerPhone,
            startsAt,
            endsAt: new Date(
              startsAt.getTime() + requested.durationHours * 3_600_000,
            ),
            durationHours: requested.durationHours,
            hourlyRateIdr,
            totalAmountIdr: amount.toString(),
            status: 'pending',
            holdExpiresAt: expiresAt,
          };
        });
        if (totalAmount > 999_999_999_999n) {
          throw new BadRequestException(
            'Total pembayaran melebihi batas DOKU.',
          );
        }
        const values: unknown[] = [];
        const bookingPlaceholders = bookingRows.map((booking, index) => {
          const offset = index * 13;
          values.push(
            booking.reference,
            booking.outletId,
            booking.tableId,
            booking.userId,
            booking.customerName,
            booking.customerContact,
            booking.startsAt,
            booking.endsAt,
            booking.durationHours,
            booking.hourlyRateIdr,
            booking.totalAmountIdr,
            booking.status,
            booking.holdExpiresAt,
          );
          return `(${Array.from({ length: 13 }, (_, column) => `$${offset + column + 1}`).join(', ')})`;
        });
        const savedBookings = (await manager.query(
          `INSERT INTO bookings
           (reference, outlet_id, table_id, user_id, customer_name, customer_contact,
            starts_at, ends_at, duration_hours, hourly_rate_idr, total_amount_idr, status, hold_expires_at)
           VALUES ${bookingPlaceholders.join(', ')}
           RETURNING id, reference`,
          values,
        )) as { id: string; reference: string }[];
        const bookingIdByReference = new Map(
          savedBookings.map((row) => [row.reference, row.id]),
        );
        const relationValues: unknown[] = [];
        const paymentValues: unknown[] = [];
        for (const booking of bookingRows) {
          const bookingId = bookingIdByReference.get(booking.reference)!;
          relationValues.push(savedSession.id, bookingId);
          paymentValues.push(
            bookingId,
            savedSession.id,
            'charge',
            'pending',
            booking.totalAmountIdr,
            `DOKU_${environment.toUpperCase()}`,
            null,
            `${invoiceNumber}_${booking.reference}`,
            null,
            null,
          );
        }
        const relationPlaceholders = bookingRows.map(
          (_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`,
        );
        await manager.query(
          `INSERT INTO payment_session_bookings (payment_session_id, booking_id)
           VALUES ${relationPlaceholders.join(', ')}`,
          relationValues,
        );
        const paymentPlaceholders = bookingRows.map(
          (_, index) =>
            `(${Array.from({ length: 10 }, (_value, column) => `$${index * 10 + column + 1}`).join(', ')})`,
        );
        await manager.query(
          `INSERT INTO payments
           (booking_id, payment_session_id, kind, status, amount_idr, provider,
            provider_reference, idempotency_key, original_payment_id, settled_at)
           VALUES ${paymentPlaceholders.join(', ')}`,
          paymentValues,
        );

        savedSession.amountIdr = totalAmount.toString();
        return sessionRepository.save(savedSession);
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23P01'
      ) {
        throw new ConflictException('Slot yang dipilih sudah tidak tersedia.');
      }
      throw error;
    }

    try {
      const webUrl = this.publicWebUrl();
      const backendUrl = this.config
        .get<string>('BACKEND_PUBLIC_URL')
        ?.replace(/\/$/, '');
      const checkout = await this.doku.createCheckout(environment, {
        invoiceNumber,
        amount: Number(checkoutSession.amountIdr),
        customerName,
        customerPhone,
        customerEmail,
        callbackUrl: `${webUrl}/payment/result/${invoiceNumber}`,
        notificationUrl: backendUrl
          ? `${backendUrl}/payments/doku/${environment}/notification`
          : undefined,
      });
      const actualExpiry = checkout.expiresAt;
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(PaymentSessionEntity).update(
          { id: checkoutSession.id, status: 'pending' },
          {
            checkoutUrl: checkout.checkoutUrl,
            dokuSessionId: checkout.dokuSessionId,
            expiresAt: actualExpiry,
          },
        );
        await manager.query(
          `UPDATE bookings SET hold_expires_at = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id IN (SELECT booking_id FROM payment_session_bookings WHERE payment_session_id = $1)
             AND status = 'pending'`,
          [checkoutSession.id, actualExpiry],
        );
      });
      return {
        reference: invoiceNumber,
        checkoutUrl: checkout.checkoutUrl,
        expiresAt: checkout.expiresAt,
      };
    } catch (error) {
      await this.expireSession(checkoutSession.id, 'failed');
      throw error;
    }
  }

  /** Applies an already signature-verified DOKU success notification idempotently. */
  async handleNotification(
    environment: DokuEnvironment,
    body: DokuNotification,
    requestId: string,
  ) {
    const invoiceNumber = body.order?.invoice_number;
    const amount = Number(body.order?.amount);
    const transactionStatus = body.transaction?.status;
    if (
      typeof invoiceNumber !== 'string' ||
      !Number.isSafeInteger(amount) ||
      (transactionStatus !== 'SUCCESS' && transactionStatus !== 'FAILED')
    ) {
      throw new BadRequestException('Payload notifikasi DOKU tidak valid.');
    }
    if (transactionStatus === 'FAILED') return { message: 'SUCCESS' };
    const transactionDate = body.transaction?.date;
    const settledAt =
      typeof transactionDate === 'string' &&
      Number.isFinite(Date.parse(transactionDate))
        ? new Date(transactionDate)
        : new Date();

    const session = await this.sessions.findOne({
      where: { invoiceNumber, environment },
    });
    if (!session || BigInt(session.amountIdr) !== BigInt(amount)) {
      throw new NotFoundException('Order DOKU tidak ditemukan.');
    }
    await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(PaymentSessionEntity);
      const locked = await sessions.findOne({
        where: { id: session.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status === 'succeeded') return;

      const linkedBookings = (await manager.query(
        `SELECT b.id, b.status
         FROM payment_session_bookings psb
         JOIN bookings b ON b.id = psb.booking_id
         WHERE psb.payment_session_id = $1
         FOR UPDATE OF b`,
        [locked.id],
      )) as { id: string; status: string }[];
      const canConfirm =
        settledAt.getTime() <= locked.expiresAt.getTime() &&
        linkedBookings.length > 0 &&
        linkedBookings.every(
          (booking) =>
            booking.status === 'pending' || booking.status === 'expired',
        );
      let reservationNeedsReview = !canConfirm;
      if (canConfirm) {
        const overlaps = (await manager.query(
          `SELECT EXISTS (
             SELECT 1 FROM payment_session_bookings own
             JOIN bookings held ON held.id = own.booking_id
             JOIN bookings other ON other.table_id = held.table_id
               AND other.id <> held.id
               AND other.status IN ('pending', 'confirmed', 'in_progress')
               AND other.starts_at < held.ends_at AND other.ends_at > held.starts_at
               AND (other.status <> 'pending' OR other.hold_expires_at > CURRENT_TIMESTAMP)
             WHERE own.payment_session_id = $1
           ) AS conflict`,
          [locked.id],
        )) as [{ conflict: boolean }];
        reservationNeedsReview = Boolean(overlaps[0]?.conflict);
      }

      if (canConfirm && !reservationNeedsReview) {
        await manager.query(
          `UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
           WHERE id IN (SELECT booking_id FROM payment_session_bookings WHERE payment_session_id = $1)
             AND status IN ('pending', 'expired')`,
          [locked.id],
        );
      }
      if (reservationNeedsReview) {
        await manager.query(
          `UPDATE bookings SET status = 'expired', updated_at = CURRENT_TIMESTAMP
           WHERE id IN (SELECT booking_id FROM payment_session_bookings WHERE payment_session_id = $1)
             AND status = 'pending'`,
          [locked.id],
        );
      }
      await manager.query(
        `UPDATE payments SET status = 'succeeded', settled_at = $2,
           updated_at = CURRENT_TIMESTAMP WHERE payment_session_id = $1`,
        [locked.id, settledAt],
      );
      await sessions.update(locked.id, {
        status: 'succeeded',
        settledAt,
        notificationRequestId: requestId,
        reservationNeedsReview,
      });
    });
    return { message: 'SUCCESS' };
  }

  /** Returns guest-facing payment details and expires an overdue session. */
  async getPublicStatus(reference: string) {
    const session = await this.sessions.findOne({
      where: { invoiceNumber: reference },
    });
    if (!session) throw new NotFoundException('Pembayaran tidak ditemukan.');
    if (
      session.status === 'pending' &&
      session.expiresAt.getTime() <= Date.now()
    ) {
      await this.expireSession(session.id, 'expired');
    }
    const current = await this.sessions.findOneByOrFail({ id: session.id });
    const bookingRows = await this.dataSource.query(
      `SELECT b.reference, o.name AS "outletName", t.name AS "tableName",
         b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.duration_hours AS "durationHours",
         b.total_amount_idr AS "totalAmountIdr", b.status AS "bookingStatus"
       FROM payment_session_bookings psb
       JOIN bookings b ON b.id = psb.booking_id
       JOIN outlets o ON o.id = b.outlet_id
       JOIN mahjong_tables t ON t.id = b.table_id
       WHERE psb.payment_session_id = $1
       ORDER BY b.starts_at ASC, t.name ASC`,
      [current.id],
    );
    return {
      reference: current.invoiceNumber,
      status: current.status,
      environment: current.environment,
      customerName: current.customerName,
      amountIdr: current.amountIdr,
      expiresAt: current.expiresAt,
      settledAt: current.settledAt,
      reservationNeedsReview: current.reservationNeedsReview,
      bookings: bookingRows,
    };
  }

  /** Expires all sessions whose DOKU payment deadline has passed. */
  private async expireOverdueSessions() {
    await this.dataSource.query(
      `WITH overdue AS MATERIALIZED (
         SELECT id FROM payment_sessions
         WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP
         FOR UPDATE SKIP LOCKED
       ),
       expired_bookings AS (
         UPDATE bookings SET status = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE id IN (
           SELECT psb.booking_id FROM payment_session_bookings psb
           JOIN overdue ON overdue.id = psb.payment_session_id
         ) AND status = 'pending'
         RETURNING id
       ),
       expired_payments AS (
         UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP
         WHERE payment_session_id IN (SELECT id FROM overdue) AND status = 'pending'
         RETURNING id
       )
       UPDATE payment_sessions SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE id IN (SELECT id FROM overdue)`,
    );
  }

  private async expireSession(id: string, status: 'failed' | 'expired') {
    await this.dataSource.transaction(async (manager) => {
      const sessionRepository = manager.getRepository(PaymentSessionEntity);
      const session = await sessionRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session || session.status !== 'pending') return;
      await manager.query(
        `UPDATE bookings SET status = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE id IN (SELECT booking_id FROM payment_session_bookings WHERE payment_session_id = $1)
           AND status = 'pending'`,
        [id],
      );
      await manager.query(
        `UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP
         WHERE payment_session_id = $1 AND status = 'pending'`,
        [id],
      );
      await sessionRepository.update(id, { status });
    });
  }

  private validateRequestedSessions(
    dto: CreateDokuCheckoutDto,
    timeZone: string,
    openingHour: number,
    closingHour: number,
  ) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const overnight = closingHour < openingHour;
    const localClosingHour = overnight ? closingHour + 24 : closingHour;
    for (const session of dto.sessions) {
      const startsAt = new Date(session.startsAt);
      const parts = formatter.formatToParts(startsAt);
      const localPart = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === type)?.value);
      const localHour = localPart('hour');
      // Morning hours belong to the preceding operating day only when overnight.
      const localStartHour =
        overnight && localHour < openingHour ? localHour + 24 : localHour;
      if (
        !Number.isFinite(startsAt.getTime()) ||
        startsAt.getTime() <= Date.now() ||
        !Number.isSafeInteger(session.durationHours) ||
        session.durationHours < 1 ||
        session.durationHours > 10 ||
        !Number.isSafeInteger(
          startsAt.getTime() + session.durationHours * 3_600_000,
        ) ||
        localStartHour < openingHour ||
        localStartHour + session.durationHours > localClosingHour ||
        localPart('minute') !== 0 ||
        localPart('second') !== 0 ||
        startsAt.getUTCMilliseconds() !== 0
      ) {
        throw new BadRequestException('Jadwal booking tidak valid.');
      }
    }
  }

  private publicWebUrl() {
    const configured =
      this.config.get<string>('WEB_PUBLIC_URL')?.trim() ||
      this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
    return configured.replace(/\/$/, '');
  }
}
