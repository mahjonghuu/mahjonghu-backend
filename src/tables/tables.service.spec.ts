import type { Repository } from 'typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { TableEntity } from './entities/table.entity.js';
import { TablesService } from './tables.service.js';

describe('TablesService', () => {
  it('derives occupied status ahead of table condition and converts database rates', async () => {
    const rows = [
      {
        id: 'table-1',
        outletId: 'outlet-1',
        name: 'Meja 01',
        rate: '75000',
        condition: 'maintenance',
        occupied: true,
      },
      {
        id: 'table-2',
        outletId: 'outlet-1',
        name: 'Meja 02',
        rate: '90000',
        condition: 'maintenance',
        occupied: false,
      },
    ];
    const tableRepository = {
      query: vi.fn().mockResolvedValue(rows),
    } as unknown as Repository<TableEntity>;
    const service = new TablesService(
      tableRepository,
      {} as Repository<OutletEntity>,
    );

    await expect(service.findAll()).resolves.toEqual([
      {
        id: 'table-1',
        outletId: 'outlet-1',
        name: 'Meja 01',
        rate: 75000,
        status: 'Digunakan',
      },
      {
        id: 'table-2',
        outletId: 'outlet-1',
        name: 'Meja 02',
        rate: 90000,
        status: 'Perawatan',
      },
    ]);
  });
});
