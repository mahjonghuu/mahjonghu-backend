import type { DataSource } from 'typeorm';
import { DashboardService } from './dashboard.service.js';

describe('DashboardService', () => {
  it('returns backend-computed metrics and outlet revenue shares for filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'outlet-1', name: 'MahjongHu Jakarta', active: true },
        { id: 'outlet-2', name: 'MahjongHu Bandung', active: false },
      ])
      .mockResolvedValueOnce([
        { status: 'Digunakan', count: 2, available_count: 0 },
        { status: 'Tersedia', count: 3, available_count: 2 },
      ])
      .mockResolvedValueOnce([
        { id: 'outlet-1', name: 'MahjongHu Jakarta', amountIdr: '300000' },
        { id: 'outlet-2', name: 'MahjongHu Bandung', amountIdr: '100000' },
      ])
      .mockResolvedValueOnce([
        { revenueIdr: '400000', paidTransactionCount: 3, playedHours: 7 },
      ])
      .mockResolvedValueOnce([
        {
          id: 'booking-1',
          customer: 'Guest',
          outletName: 'MahjongHu Jakarta',
          tableName: 'Table 1',
          settledAt: '2026-10-15T09:00:00.000Z',
          hours: 2,
          amountIdr: '150000',
        },
      ]);
    const service = new DashboardService({ query } as unknown as DataSource);

    await expect(service.summary('2026-10-01', '2026-10-15')).resolves.toEqual({
      outlets: [
        { id: 'outlet-1', name: 'MahjongHu Jakarta', active: true },
        { id: 'outlet-2', name: 'MahjongHu Bandung', active: false },
      ],
      metrics: {
        revenueIdr: '400000',
        paidTransactionCount: 3,
        playedHours: 7,
        occupiedTableCount: 2,
        tableCount: 5,
        activeOutletCount: 1,
        availableTableCount: 2,
        tablesByStatus: [
          { status: 'Digunakan', count: 2 },
          { status: 'Tersedia', count: 3 },
        ],
      },
      revenueByOutlet: [
        {
          id: 'outlet-1',
          name: 'MahjongHu Jakarta',
          amountIdr: '300000',
          sharePercent: 75,
          barPercent: 100,
        },
        {
          id: 'outlet-2',
          name: 'MahjongHu Bandung',
          amountIdr: '100000',
          sharePercent: 25,
          barPercent: 33.33,
        },
      ],
      transactions: [
        {
          id: 'booking-1',
          customer: 'Guest',
          outletName: 'MahjongHu Jakarta',
          tableName: 'Table 1',
          settledAt: '2026-10-15T09:00:00.000Z',
          hours: 2,
          amountIdr: '150000',
        },
      ],
    });
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[1][0]).toContain("b.status = 'in_progress'");
    expect(query.mock.calls[3][1]).toEqual(['2026-10-01', '2026-10-15']);
  });

  it('returns every filtered paid booking and the backend-rounded average for revenue reports', async () => {
    const transactions = [
      {
        id: 'booking-1',
        outletId: 'outlet-1',
        tableId: 'table-1',
        customer: 'Guest',
        outletName: 'MahjongHu Jakarta',
        tableName: 'Table 1',
        settledAt: '2026-10-15T09:00:00.000Z',
        hours: 2,
        amountIdr: '400000',
      },
    ];
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'outlet-1', name: 'MahjongHu Jakarta', active: true }])
      .mockResolvedValueOnce([{ status: 'Tersedia', count: 1, available_count: 1 }])
      .mockResolvedValueOnce([{ id: 'outlet-1', name: 'MahjongHu Jakarta', amountIdr: '400000' }])
      .mockResolvedValueOnce([{ revenueIdr: '400000', paidTransactionCount: 3, playedHours: 7 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(transactions);
    const service = new DashboardService({ query } as unknown as DataSource);

    const result = await service.revenueReport('2026-10-01', '2026-10-15', 'outlet-1');

    expect(result.metrics.averageTransactionIdr).toBe(133333);
    expect(result.transactions).toEqual(transactions);
    expect(query).toHaveBeenCalledTimes(6);
    expect(query.mock.calls[5][0]).toContain('GROUP BY b.id');
    expect(query.mock.calls[5][0]).not.toContain('LIMIT');
    expect(query.mock.calls[5][1]).toEqual(['2026-10-01', '2026-10-15', 'outlet-1']);
  });
});
