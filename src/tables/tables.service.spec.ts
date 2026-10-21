import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Repository } from 'typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { CreateTableDto } from './dto/create-table.dto.js';
import { UpdateTableDto } from './dto/update-table.dto.js';
import { TableEntity } from './entities/table.entity.js';
import { TablesService } from './tables.service.js';

describe('TablesService', () => {
  it('derives occupied status ahead of table condition without exposing pricing', async () => {
    const rows = [
      { id: 'table-1', outletId: 'outlet-1', name: 'Meja 01', condition: 'maintenance', occupied: true },
      { id: 'table-2', outletId: 'outlet-1', name: 'Meja 02', condition: 'maintenance', occupied: false },
    ];
    const tableRepository = {
      query: vi.fn().mockResolvedValue(rows),
    } as unknown as Repository<TableEntity>;
    const service = new TablesService(tableRepository, {} as Repository<OutletEntity>);
    const expected = [
      { id: 'table-1', outletId: 'outlet-1', name: 'Meja 01', status: 'Digunakan' },
      { id: 'table-2', outletId: 'outlet-1', name: 'Meja 02', status: 'Perawatan' },
    ];
    await expect(service.findAll()).resolves.toEqual(expected);
    await expect(service.findPublic()).resolves.toEqual(expected);
  });

  it('creates and updates a table without changing outlet pricing', async () => {
    const table = {
      id: 'table-1', outletId: 'outlet-1', name: 'Meja 01', condition: 'available' as const,
    };
    const tables = {
      create: vi.fn((value: typeof table) => ({ ...value, id: 'table-1' })),
      save: vi.fn(async (value: typeof table) => value),
      findOneBy: vi.fn().mockResolvedValue(table),
    } as unknown as Repository<TableEntity>;
    const outlets = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'outlet-1', isActive: true, hourlyRateIdr: '100000' }),
    } as unknown as Repository<OutletEntity>;
    const service = new TablesService(tables, outlets);

    await expect(service.create({ outletId: 'outlet-1', name: 'Meja 01', status: 'Tersedia' }))
      .resolves.toEqual({ id: 'table-1', outletId: 'outlet-1', name: 'Meja 01', status: 'Tersedia' });
    await expect(service.update('table-1', { name: 'Meja 02' }))
      .resolves.toEqual({ id: 'table-1', outletId: 'outlet-1', name: 'Meja 02', status: 'Tersedia' });
    expect(tables.create).toHaveBeenCalledWith(expect.not.objectContaining({ hourlyRateIdr: expect.anything() }));
    expect(outlets.findOneBy).toHaveBeenCalledTimes(1);
  });

  it('rejects obsolete rate fields in table create and update DTOs', async () => {
    const create = {
      outletId: '15818cd8-b3c0-45b0-aea3-d8dc15df93b2',
      name: 'Meja', status: 'Tersedia',
    };
    const options = { whitelist: true, forbidNonWhitelisted: true };
    expect(await validate(plainToInstance(CreateTableDto, create), options)).toEqual([]);
    expect(await validate(plainToInstance(UpdateTableDto, {}), options)).toEqual([]);
    for (const extra of [{ rate: 100000 }, { rateTiers: [] }]) {
      expect(await validate(plainToInstance(CreateTableDto, { ...create, ...extra }), options))
        .not.toEqual([]);
      expect(await validate(plainToInstance(UpdateTableDto, extra), options))
        .not.toEqual([]);
    }
  });
});
