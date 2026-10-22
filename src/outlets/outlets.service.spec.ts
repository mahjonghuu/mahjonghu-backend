import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { CreateOutletDto } from './dto/create-outlet.dto.js';
import { UpdateOutletDto } from './dto/update-outlet.dto.js';
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
        rate: '100000',
        rateTiers: [{ durationHours: 2, rate: 80000 }],
        pricingMode: 'duration',
        happyHour: null,
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
        rate: 100000,
        rateTiers: [{ durationHours: 2, rate: 80000 }],
        pricingMode: 'duration',
        happyHour: null,
        openingHour: 9,
        closingHour: 23,
        tableCount: 7,
        occupiedTableCount: 2,
      },
    ]);
    await expect(service.findPublic()).resolves.toEqual([
      {
        id: 'outlet-1',
        name: 'MahjongHu Menteng',
        city: 'Jakarta Pusat',
        address: 'Jalan Menteng',
        active: true,
        visibility: 'public',
        rate: 100000,
        rateTiers: [{ durationHours: 2, rate: 80000 }],
        pricingMode: 'duration',
        happyHour: null,
        openingHour: 9,
        closingHour: 23,
        tableCount: 7,
        occupiedTableCount: 2,
      },
    ]);
  });

  it('trims required text and defaults new outlets to active', async () => {
    const { repository, service } = createService();
    const persisted = { id: 'outlet-1' } as OutletEntity;
    repository.create.mockImplementation(
      (outlet: Partial<OutletEntity>) => outlet,
    );
    repository.save.mockImplementation(async (outlet: OutletEntity) => Object.assign(persisted, outlet));

    await expect(
      service.create({
        name: '  MahjongHu Menteng  ',
        city: ' Jakarta Pusat ',
        address: ' Jalan Menteng ',
        rate: 100000,
      }),
    ).resolves.toEqual({
      id: 'outlet-1',
      name: 'MahjongHu Menteng',
      city: 'Jakarta Pusat',
      address: 'Jalan Menteng',
      visibility: 'public',
      active: true,
      openingHour: 12,
      closingHour: 22,
      rate: 100000,
      rateTiers: [],
      pricingMode: 'duration',
      happyHour: null,
    });
    expect(repository.create).toHaveBeenCalledWith({
      name: 'MahjongHu Menteng',
      city: 'Jakarta Pusat',
      address: 'Jalan Menteng',
      hourlyRateIdr: '100000',
      rateTiers: [],
      pricingMode: 'duration',
      happyHour: null,
      openingHour: 12,
      closingHour: 22,
      visibility: 'public',
      isActive: true,
    });
  });

  it('accepts overnight and midnight closing hours on create and update', async () => {
    const { repository, service } = createService();
    repository.create.mockImplementation(
      (outlet: Partial<OutletEntity>) => outlet,
    );
    repository.save.mockImplementation(async (outlet: OutletEntity) => outlet);
    repository.findOneBy.mockResolvedValue({
      id: 'outlet-1',
      isActive: true,
      openingHour: 13,
      closingHour: 22,
    });

    await expect(
      service.create({
        name: 'Night outlet',
        city: 'Jakarta',
        address: 'Jalan Menteng',
        rate: 75000,
        openingHour: 13,
        closingHour: 4,
      }),
    ).resolves.toMatchObject({ openingHour: 13, closingHour: 4 });
    await expect(
      service.update('outlet-1', { closingHour: 0 }),
    ).resolves.toMatchObject({ openingHour: 13, closingHour: 0 });
  });

  it('rejects equal opening and closing hours on create and update', async () => {
    const { repository, service } = createService();
    repository.create.mockImplementation(
      (outlet: Partial<OutletEntity>) => outlet,
    );
    repository.findOneBy.mockResolvedValue({
      id: 'outlet-1',
      isActive: true,
      openingHour: 13,
      closingHour: 4,
    });

    await expect(
      service.create({
        name: 'Night outlet',
        city: 'Jakarta',
        address: 'Jalan Menteng',
        rate: 75000,
        openingHour: 13,
        closingHour: 13,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.update('outlet-1', { closingHour: 13 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('changes pricing only on the selected outlet and preserves omitted tiers', async () => {
    const { repository, service } = createService();
    const first = {
      id: 'outlet-1',
      openingHour: 12,
      closingHour: 22,
      hourlyRateIdr: '75000',
      rateTiers: [{ durationHours: 2, rate: 60000 }],
    } as OutletEntity;
    const second = {
      id: 'outlet-2',
      hourlyRateIdr: '95000',
      rateTiers: [],
    } as OutletEntity;
    repository.findOneBy.mockResolvedValue(first);
    repository.save.mockImplementation(async (outlet: OutletEntity) => outlet);

    await expect(service.update(first.id, { rate: 100000 })).resolves.toMatchObject({
      rate: 100000,
      rateTiers: [{ durationHours: 2, rate: 60000 }],
    });
    await expect(service.update(first.id, { rateTiers: [] })).resolves.toMatchObject({
      rateTiers: [],
    });
    expect(second.hourlyRateIdr).toBe('95000');
    expect(second.rateTiers).toEqual([]);
  });

  it('switches modes exclusively and requires a fresh schedule when switching back', async () => {
    const { repository, service } = createService();
    const outlet = {
      id: 'outlet-1', openingHour: 12, closingHour: 22, hourlyRateIdr: '100000',
      pricingMode: 'duration', happyHour: null,
      rateTiers: [{ durationHours: 2, rate: 80000 }],
    } as OutletEntity;
    repository.findOneBy.mockResolvedValue(outlet);
    repository.save.mockImplementation(async (value: OutletEntity) => value);
    const schedule = { days: [1, 3, 5], startHour: 16, endHour: 19, rate: 60000 };

    await expect(service.update(outlet.id, { pricingMode: 'happy_hour' }))
      .rejects.toMatchObject({ status: 400 });
    await expect(service.update(outlet.id, { pricingMode: 'happy_hour', happyHour: schedule }))
      .resolves.toMatchObject({ pricingMode: 'happy_hour', happyHour: schedule, rateTiers: [] });
    await expect(service.update(outlet.id, { rateTiers: [{ durationHours: 2, rate: 80000 }] }))
      .rejects.toMatchObject({ status: 400 });
    await expect(service.update(outlet.id, { pricingMode: 'duration' }))
      .resolves.toMatchObject({ pricingMode: 'duration', happyHour: null });
    await expect(service.update(outlet.id, { pricingMode: 'happy_hour' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rejects malformed schedules and mixed modes in validated DTOs', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    const base = { name: 'Outlet', city: 'Jakarta', address: 'Street', rate: 100000 };
    const schedule = { days: [1, 5], startHour: 16, endHour: 19, rate: 60000 };
    for (const happyHour of [
      { ...schedule, days: [] }, { ...schedule, days: [1, 1] },
      { ...schedule, days: [0] }, { ...schedule, days: [8] },
      { ...schedule, days: ['1'] }, { ...schedule, endHour: 16 },
      { ...schedule, endHour: 25 }, { ...schedule, startHour: -1 },
      { ...schedule, rate: 0 }, { ...schedule, rate: 1_000_000_001 },
      { ...schedule, extra: true },
    ]) {
      expect(await validate(plainToInstance(CreateOutletDto, {
        ...base, pricingMode: 'happy_hour', happyHour,
      }), options)).not.toEqual([]);
    }
    expect(await validate(plainToInstance(CreateOutletDto, {
      ...base, pricingMode: 'happy_hour', happyHour: schedule,
    }), options)).toEqual([]);
    expect(await validate(plainToInstance(UpdateOutletDto, {
      pricingMode: 'happy_hour', happyHour: schedule,
    }), options)).toEqual([]);
    expect(await validate(plainToInstance(CreateOutletDto, {
      ...base, pricingMode: 'duration', happyHour: null,
    }), options)).toEqual([]);
    const { service } = createService();
    await expect(service.create({ ...base, happyHour: schedule })).rejects.toMatchObject({ status: 400 });
    await expect(service.create({ ...base, pricingMode: 'happy_hour', happyHour: schedule,
      rateTiers: [{ durationHours: 2, rate: 80000 }],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('validates ordered tiers and strict pricing bounds on outlets', async () => {
    const valid = { name: 'Outlet', city: 'Jakarta', address: 'Jalan', rate: 100000 };
    const options = { whitelist: true, forbidNonWhitelisted: true };
    const validateCreate = (rateTiers: unknown) =>
      validate(plainToInstance(CreateOutletDto, { ...valid, rateTiers }), options);
    for (const rateTiers of [
      [{ durationHours: 2, rate: 80000 }, { durationHours: 2, rate: 70000 }],
      [{ durationHours: 3, rate: 80000 }, { durationHours: 2, rate: 70000 }],
      [{ durationHours: 1, rate: 80000 }],
      [{ durationHours: 11, rate: 80000 }],
      [{ durationHours: 2.5, rate: 80000 }],
      [{ durationHours: '2', rate: 80000 }],
      [{ durationHours: 2, rate: 0 }],
      [{ durationHours: 2, rate: 1_000_000_001 }],
      [{ durationHours: 2, rate: '80000' }],
      [{ durationHours: 2, rate: 80000, unexpected: true }],
      null,
      {},
    ]) {
      expect(await validateCreate(rateTiers)).not.toEqual([]);
    }
    expect(await validateCreate([
      { durationHours: 2, rate: 80000 },
      { durationHours: 10, rate: 50000 },
    ])).toEqual([]);
    expect(await validate(plainToInstance(CreateOutletDto, { ...valid, rate: 0 }))).not.toEqual([]);
    expect(await validate(plainToInstance(UpdateOutletDto, {}))).toEqual([]);
    expect(await validate(plainToInstance(UpdateOutletDto, { rateTiers: [] }))).toEqual([]);
    expect(await validate(plainToInstance(UpdateOutletDto, { rateTiers: null }))).not.toEqual([]);
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
        rate: 75000,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Nama outlet sudah digunakan.',
    });
  });
});
