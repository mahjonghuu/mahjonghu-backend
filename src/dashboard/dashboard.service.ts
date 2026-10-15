import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type DashboardSummary = {
  outlets: { id: string; name: string; active: boolean }[];
  metrics: {
    revenueIdr: string;
    paidTransactionCount: number;
    playedHours: number;
    occupiedTableCount: number;
    tableCount: number;
    activeOutletCount: number;
    availableTableCount: number;
    tablesByStatus: { status: string; count: number }[];
  };
  revenueByOutlet: { id: string; name: string; amountIdr: string; sharePercent: number; barPercent: number }[];
  transactions: {
    id: string;
    customer: string;
    outletName: string;
    tableName: string;
    settledAt: string;
    hours: number;
    amountIdr: string;
  }[];
};

/** Calculates dashboard metrics in PostgreSQL and returns display-ready aggregates. */
@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  async summary(from?: string, to?: string, outletId?: string): Promise<DashboardSummary> {
    const outletParams: unknown[] = [];
    const outletClause = outletId ? 'AND o.id = $1' : '';
    if (outletId) outletParams.push(outletId);
    const revenueParams: unknown[] = [];
    const revenueFilter: string[] = ["p.status = 'succeeded'", 'p.settled_at IS NOT NULL'];
    if (from) {
      revenueParams.push(from);
      revenueFilter.push(`p.settled_at >= $${revenueParams.length}::date`);
    }
    if (to) {
      revenueParams.push(to);
      revenueFilter.push(`p.settled_at < ($${revenueParams.length}::date + INTERVAL '1 day')`);
    }
    if (outletId) {
      revenueParams.push(outletId);
      revenueFilter.push(`b.outlet_id = $${revenueParams.length}`);
    }
    const outlets = await this.dataSource.query(
      `SELECT id, name, is_active AS active FROM outlets WHERE archived_at IS NULL ORDER BY name, id`,
    ) as DashboardSummary['outlets'];
    const tableRows = await this.dataSource.query(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.table_id = t.id AND b.outlet_id = t.outlet_id AND b.status = 'in_progress') THEN 'Digunakan' WHEN t.condition = 'maintenance' THEN 'Perawatan' ELSE 'Tersedia' END AS status,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE o.is_active = true AND t.condition = 'available' AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.table_id = t.id AND b.outlet_id = t.outlet_id AND b.status = 'in_progress'))::int AS available_count
       FROM mahjong_tables t JOIN outlets o ON o.id = t.outlet_id
       WHERE t.archived_at IS NULL AND o.archived_at IS NULL ${outletClause}
       GROUP BY status ORDER BY status`,
      outletParams,
    ) as { status: string; count: number; available_count: number }[];
    const revenueRows = await this.dataSource.query(
      `SELECT o.id, o.name, COALESCE(SUM(p.amount_idr::numeric), 0)::text AS "amountIdr"
       FROM outlets o LEFT JOIN bookings b ON b.outlet_id = o.id
       LEFT JOIN payments p ON p.booking_id = b.id AND ${revenueFilter.join(' AND ')}
       WHERE o.archived_at IS NULL ${outletId ? `AND o.id = $${revenueParams.length}` : ''}
       GROUP BY o.id, o.name ORDER BY o.name, o.id`,
      revenueParams,
    ) as { id: string; name: string; amountIdr: string }[];
    const totals = await this.dataSource.query(
      `WITH filtered_payments AS (
         SELECT p.booking_id, p.amount_idr::numeric AS amount_idr, b.duration_hours
         FROM payments p JOIN bookings b ON b.id = p.booking_id
         WHERE ${revenueFilter.join(' AND ')}
       ), paid_bookings AS (
         SELECT booking_id, MAX(duration_hours) AS duration_hours
         FROM filtered_payments GROUP BY booking_id
       )
       SELECT COALESCE((SELECT SUM(amount_idr) FROM filtered_payments), 0)::text AS "revenueIdr",
         (SELECT COUNT(*)::int FROM paid_bookings) AS "paidTransactionCount",
         COALESCE((SELECT SUM(duration_hours) FROM paid_bookings), 0)::int AS "playedHours"`,
      revenueParams,
    ) as [{ revenueIdr: string; paidTransactionCount: number; playedHours: number }];
    const transactions = await this.dataSource.query(
      `SELECT b.id, b.customer_name AS customer, o.name AS "outletName", t.name AS "tableName", p.settled_at AS "settledAt", b.duration_hours AS hours, p.amount_idr AS "amountIdr"
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN outlets o ON o.id = b.outlet_id JOIN mahjong_tables t ON t.id = b.table_id
       WHERE ${revenueFilter.join(' AND ')} ORDER BY p.settled_at DESC, p.id DESC LIMIT 5`,
      revenueParams,
    ) as DashboardSummary['transactions'];
    const revenueTotal = Number(totals[0]?.revenueIdr ?? 0);
    const maxOutletRevenue = Math.max(...revenueRows.map((row) => Number(row.amountIdr)), 0);
    const revenueByOutlet = revenueRows.map((row) => ({
      ...row,
      sharePercent: revenueTotal ? Number((Number(row.amountIdr) / revenueTotal * 100).toFixed(2)) : 0,
      barPercent: maxOutletRevenue ? Number((Number(row.amountIdr) / maxOutletRevenue * 100).toFixed(2)) : 0,
    }));
    return {
      outlets,
      metrics: {
        ...totals[0],
        occupiedTableCount: tableRows.find((row) => row.status === 'Digunakan')?.count ?? 0,
        tableCount: tableRows.reduce((sum, row) => sum + row.count, 0),
        activeOutletCount: outlets.filter((outlet) => outlet.active && (!outletId || outlet.id === outletId)).length,
        availableTableCount: tableRows.reduce((sum, row) => sum + row.available_count, 0),
        tablesByStatus: tableRows.map(({ status, count }) => ({ status, count })),
      },
      revenueByOutlet,
      transactions,
    };
  }
}
