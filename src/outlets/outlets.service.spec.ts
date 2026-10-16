import { ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { OutletEntity } from './entities/outlet.entity.js';
import { OutletsService } from './outlets.service.js';

describe('OutletsService', () => {
  function createService() {
    const repository = {
      create: vi.fn(),
      findOneBy: vi.fn(),
      query: vi.fn(),
      save: vi.fn(),
    };
    return {
      repository,
      service: new OutletsService(
        repository as unknown as Repository<OutletEntity>,
      ),
    };
  }

  it('maps counts returned by the database to numeric dashboard summaries', async () => {
    const { repository, service } = createService();
    repository.query.mockResolvedValue([
      {
        id: 'outlet-1',
        name: 'MahjongHu Menteng',
        city: 'Jakarta Pusat',
        address: 'Jalan Menteng',
        visibility: 'public',
        active: true,
        openingHour: '9',
        closingHour: '23',
        tableCount: '7',
        occupiedTableCount: '2',
      },
    ]);

    await expect(service.findAll()).resolves.toEqual([
      {
        id: 'outlet-1',
        name: 'MahjongHu Menteng',
        city: 'Jakarta Pusat',
        address: 'Jalan Menteng',
        active: true,
        visibility: 'public',
        openingHour: 9,
        closingHour: 23,
        tableCount: 7,
        occupiedTableCount: 2,
      },
    ]);
  });

  it('trims required text and defaults new outlets to active', async () => {
    const { repository, service } = createService();
    const persisted = { id: 'outlet-1', isActive: true } as OutletEntity;
    repository.create.mockImplementation(
      (outlet: Partial<OutletEntity>) => outlet,
    );
    repository.save.mockResolvedValue(persisted);

    await expect(
      service.create({
        name: '  MahjongHu Menteng  ',
        city: ' Jakarta Pusat ',
        address: ' Jalan Menteng ',
      }),
    ).resolves.toBe(persisted);
    expect(repository.create).toHaveBeenCalledWith({
      name: 'MahjongHu Menteng',
      city: 'Jakarta Pusat',
      address: 'Jalan Menteng',
      openingHour: 12,
      closingHour: 22,
      visibility: 'public',
      isActive: true,
    });
  });

  it('rejects deactivation while an outlet has an in-progress booking', async () => {
    const { repository, service } = createService();
    repository.findOneBy.mockResolvedValue({ id: 'outlet-1', isActive: true });
    repository.query.mockResolvedValue([{ occupied: true }]);

    await expect(
      service.update('outlet-1', { active: false }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Selesaikan penggunaan meja sebelum menonaktifkan outlet.',
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('does not archive an outlet with tables or booking history', async () => {
    const { repository, service } = createService();
    repository.findOneBy.mockResolvedValue({ id: 'outlet-1', isActive: true });
    repository.query
      .mockResolvedValueOnce([{ hasTables: true }])
      .mockResolvedValueOnce([{ hasBookings: false }]);

    await expect(service.archive('outlet-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('archives an unused outlet and marks it inactive', async () => {
    const { repository, service } = createService();
    const outlet = { id: 'outlet-1', isActive: true, archivedAt: null };
    repository.findOneBy.mockResolvedValue(outlet);
    repository.query
      .mockResolvedValueOnce([{ hasTables: false }])
      .mockResolvedValueOnce([{ hasBookings: false }]);
    repository.save.mockImplementation(async (value: OutletEntity) => value);

    await service.archive('outlet-1');

    expect(outlet.isActive).toBe(false);
    expect(outlet.archivedAt).toBeInstanceOf(Date);
    expect(repository.save).toHaveBeenCalledWith(outlet);
  });

  it('maps duplicate outlet names to a conflict response', async () => {
    const { repository, service } = createService();
    repository.create.mockImplementation(
      (outlet: Partial<OutletEntity>) => outlet,
    );
    repository.save.mockRejectedValue({ driverError: { code: '23505' } });

    await expect(
      service.create({
        name: 'MahjongHu Menteng',
        city: 'Jakarta Pusat',
        address: 'Jalan Menteng',
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Nama outlet sudah digunakan.',
    });
  });
});
