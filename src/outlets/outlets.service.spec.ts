import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { CreateOutletDto } from './dto/create-outlet.dto.js';
import { UpdateOutletDto } from './dto/update-outlet.dto.js';
import { OutletEntity } from './entities/outlet.entity.js';
import { OutletsService } from './outlets.service.js';
import { SupabaseImageStorage } from '../common/storage/supabase-image.storage.js';

describe('OutletsService', () => {
  function createService() {
    const repository = {
      create: vi.fn(),
      findOneBy: vi.fn(),
      query: vi.fn(),
      save: vi.fn(),
    };
    const photos = {
      upload: vi
        .fn()
        .mockResolvedValue(
          'https://project.supabase.co/storage/v1/object/public/outlet-photos/outlets/new.jpg',
        ),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    return {
      repository,
      photos,
      service: new OutletsService(
        repository as unknown as Repository<OutletEntity>,
        photos as unknown as SupabaseImageStorage,
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
        photo: null,
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
        photo: null,
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
    repository.save.mockImplementation(async (outlet: OutletEntity) =>
      Object.assign(persisted, outlet),
    );

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
      photo: null,
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
      photo: null,
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

  const photo = 'data:image/jpeg;base64,/9j/2Q==';
  const oldUrl =
    'https://project.supabase.co/storage/v1/object/public/outlet-photos/outlets/old.jpg';
  const newUrl =
    'https://project.supabase.co/storage/v1/object/public/outlet-photos/outlets/new.jpg';

  function existingOutlet(): OutletEntity {
    return {
      id: 'outlet-1',
      name: 'Outlet',
      city: 'Jakarta',
      address: 'Jalan',
      timezone: 'Asia/Jakarta',
      hourlyRateIdr: '75000',
      visibility: 'public',
      isActive: true,
      archivedAt: null,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: new Date('2026-10-01T00:00:00Z'),
      openingHour: 12,
      closingHour: 22,
      photo: oldUrl,
      pricingMode: 'duration',
      rateTiers: [],
      happyHour: null,
    };
  }

  it('uploads a new photo and persists only its returned public URL', async () => {
    const { repository, photos, service } = createService();
    repository.create.mockImplementation((value: Partial<OutletEntity>) => ({
      id: 'outlet-1',
      ...value,
    }));
    repository.save.mockImplementation(async (value: OutletEntity) => {
      expect(photos.upload).toHaveBeenCalledWith(photo, 'outlets');
      expect(value.photo).toBe(newUrl);
      return value;
    });
    await expect(
      service.create({
        name: 'Outlet',
        city: 'Jakarta',
        address: 'Jalan',
        rate: 75000,
        photo,
      }),
    ).resolves.toMatchObject({ photo: newUrl });
    expect(photos.upload).toHaveBeenCalledTimes(1);
    expect(photos.remove).not.toHaveBeenCalled();
  });

  it('preserves an omitted photo without uploading or deleting it', async () => {
    const { repository, photos, service } = createService();
    repository.findOneBy.mockResolvedValue(existingOutlet());
    repository.save.mockImplementation(async (value: OutletEntity) => value);
    await expect(
      service.update('outlet-1', { city: 'Bandung' }),
    ).resolves.toMatchObject({ photo: oldUrl });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ photo: oldUrl }),
    );
    expect(photos.upload).not.toHaveBeenCalled();
    expect(photos.remove).not.toHaveBeenCalled();
  });

  it.each([null, photo])(
    'retires the previous photo only after saving replacement %s',
    async (replacement) => {
      const { repository, photos, service } = createService();
      repository.findOneBy.mockResolvedValue(existingOutlet());
      const expected = replacement === null ? null : newUrl;
      repository.save.mockImplementation(async (value: OutletEntity) => {
        expect(value.photo).toBe(expected);
        expect(photos.remove).not.toHaveBeenCalled();
        return value;
      });
      photos.remove.mockImplementation(async () => {
        expect(repository.save).toHaveBeenCalledTimes(1);
      });
      await expect(
        service.update('outlet-1', { photo: replacement }),
      ).resolves.toMatchObject({ photo: expected });
      expect(photos.remove).toHaveBeenCalledExactlyOnceWith(oldUrl, 'outlets');
      expect(photos.upload).toHaveBeenCalledTimes(replacement === null ? 0 : 1);
    },
  );

  it('compensates a replacement upload on database failure and retains the old file', async () => {
    const { repository, photos, service } = createService();
    const previous = existingOutlet();
    const failure = new Error('database failed');
    repository.findOneBy.mockResolvedValue(previous);
    repository.save.mockRejectedValue(failure);
    await expect(service.update('outlet-1', { photo })).rejects.toBe(failure);
    expect(photos.remove).toHaveBeenCalledExactlyOnceWith(newUrl, 'outlets');
    expect(previous.photo).toBe(oldUrl);
  });

  it('keeps the old file when saving explicit photo removal fails', async () => {
    const { repository, photos, service } = createService();
    repository.findOneBy.mockResolvedValue(existingOutlet());
    const failure = new Error('database failed');
    repository.save.mockRejectedValue(failure);
    await expect(service.update('outlet-1', { photo: null })).rejects.toBe(
      failure,
    );
    expect(photos.upload).not.toHaveBeenCalled();
    expect(photos.remove).not.toHaveBeenCalled();
  });

  it('compensates a failed create without hiding its mapped conflict or cleanup failure', async () => {
    const { repository, photos, service } = createService();
    repository.create.mockImplementation(
      (value: Partial<OutletEntity>) => value,
    );
    repository.save.mockRejectedValue({ driverError: { code: '23505' } });
    photos.remove.mockRejectedValue(new Error('storage cleanup failed'));
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await expect(
        service.create({
          name: 'Outlet',
          city: 'Jakarta',
          address: 'Jalan',
          rate: 75000,
          photo,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(photos.remove).toHaveBeenCalledExactlyOnceWith(newUrl, 'outlets');
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it('keeps a committed replacement successful when old object cleanup fails', async () => {
    const { repository, photos, service } = createService();
    repository.findOneBy.mockResolvedValue(existingOutlet());
    repository.save.mockImplementation(async (value: OutletEntity) => value);
    photos.remove.mockRejectedValue(new Error('cleanup failed'));
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await expect(
        service.update('outlet-1', { photo }),
      ).resolves.toMatchObject({ photo: newUrl });
      expect(photos.remove).toHaveBeenCalledExactlyOnceWith(oldUrl, 'outlets');
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it.each([false, true])(
    'does not save when storage is unavailable (create: %s)',
    async (creating) => {
      const { repository, photos, service } = createService();
      repository.create.mockImplementation(
        (value: Partial<OutletEntity>) => value,
      );
      repository.findOneBy.mockResolvedValue(existingOutlet());
      photos.upload.mockRejectedValue(
        new ServiceUnavailableException('Photo storage unavailable.'),
      );
      const action = creating
        ? service.create({
            name: 'Outlet',
            city: 'Jakarta',
            address: 'Jalan',
            rate: 75000,
            photo,
          })
        : service.update('outlet-1', { photo });
      await expect(action).rejects.toMatchObject({ status: 503 });
      expect(repository.save).not.toHaveBeenCalled();
      expect(photos.remove).not.toHaveBeenCalled();
    },
  );

  it('validates other outlet fields before uploading and rejects invalid photo types before mutation', async () => {
    const { repository, photos, service } = createService();
    const previous = existingOutlet();
    repository.findOneBy.mockResolvedValue(previous);
    repository.create.mockImplementation(
      (value: Partial<OutletEntity>) => value,
    );
    await expect(
      service.update('outlet-1', { photo, name: ' ' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.update('outlet-1', { photo, closingHour: 12 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.create({
        name: 'Outlet',
        city: 'Jakarta',
        address: 'Jalan',
        rate: 75000,
        photo,
        openingHour: 12,
        closingHour: 12,
      }),
    ).rejects.toMatchObject({ status: 400 });
    for (const invalid of [42, false, {}, []]) {
      await expect(
        service.update('outlet-1', {
          photo: invalid as unknown as string,
          city: 'Bandung',
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.create({
          name: 'Outlet',
          city: 'Jakarta',
          address: 'Jalan',
          rate: 75000,
          photo: invalid as unknown as string,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(previous.city).toBe('Jakarta');
    expect(previous.photo).toBe(oldUrl);
    expect(repository.save).not.toHaveBeenCalled();
    expect(photos.upload).not.toHaveBeenCalled();
  });

  it('does not mutate an outlet when the storage provider rejects an invalid data URL', async () => {
    const { repository, photos, service } = createService();
    const previous = existingOutlet();
    repository.findOneBy.mockResolvedValue(previous);
    photos.upload.mockRejectedValue({ status: 400 });
    await expect(
      service.update('outlet-1', { photo: 'invalid', city: 'Bandung' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(previous.city).toBe('Jakarta');
    expect(previous.photo).toBe(oldUrl);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('exposes public photo URLs without weakening discovery filters', async () => {
    const { repository, service } = createService();
    repository.query.mockResolvedValue([{ id: 'outlet-1', photo: oldUrl }]);
    expect((await service.findAll())[0].photo).toBe(oldUrl);
    expect((await service.findPublic('customer-1'))[0].photo).toBe(oldUrl);
    expect(repository.query).toHaveBeenLastCalledWith(
      expect.stringContaining(
        "AND (o.visibility = 'public' OR ($1::uuid IS NOT NULL AND EXISTS",
      ),
      ['customer-1'],
    );
  });

  it('allows optional nullable photo DTO fields but rejects non-string values', async () => {
    for (const Dto of [CreateOutletDto, UpdateOutletDto]) {
      for (const photo of [
        undefined,
        null,
        'data:image/jpeg;base64,/9j/2Q==',
      ]) {
        expect(
          await validate(
            plainToInstance(Dto, {
              name: 'Outlet',
              city: 'Jakarta',
              address: 'Jalan',
              rate: 75000,
              photo,
            }),
          ),
        ).toEqual([]);
      }
      expect(
        await validate(
          plainToInstance(Dto, {
            name: 'Outlet',
            city: 'Jakarta',
            address: 'Jalan',
            rate: 75000,
            photo: 42,
          }),
        ),
      ).not.toEqual([]);
    }
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
    const first: OutletEntity = {
      ...existingOutlet(),
      rateTiers: [{ durationHours: 2, rate: 60000 }],
    };
    const second: OutletEntity = {
      ...existingOutlet(),
      id: 'outlet-2',
      hourlyRateIdr: '95000',
    };
    repository.findOneBy.mockResolvedValue(first);
    repository.save.mockImplementation(async (outlet: OutletEntity) => outlet);

    await expect(
      service.update(first.id, { rate: 100000 }),
    ).resolves.toMatchObject({
      rate: 100000,
      rateTiers: [{ durationHours: 2, rate: 60000 }],
    });
    await expect(
      service.update(first.id, { rateTiers: [] }),
    ).resolves.toMatchObject({
      rateTiers: [],
    });
    expect(second.hourlyRateIdr).toBe('95000');
    expect(second.rateTiers).toEqual([]);
  });

  it('switches modes exclusively and requires a fresh schedule when switching back', async () => {
    const { repository, service } = createService();
    const outlet = {
      id: 'outlet-1',
      openingHour: 12,
      closingHour: 22,
      hourlyRateIdr: '100000',
      pricingMode: 'duration',
      happyHour: null,
      rateTiers: [{ durationHours: 2, rate: 80000 }],
    } as OutletEntity;
    repository.findOneBy.mockResolvedValue(outlet);
    repository.save.mockImplementation(async (value: OutletEntity) =>
      Object.assign(outlet, value),
    );
    const schedule = {
      days: [1, 3, 5],
      startHour: 16,
      endHour: 19,
      rate: 60000,
    };

    await expect(
      service.update(outlet.id, { pricingMode: 'happy_hour' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.update(outlet.id, {
        pricingMode: 'happy_hour',
        happyHour: schedule,
      }),
    ).resolves.toMatchObject({
      pricingMode: 'happy_hour',
      happyHour: schedule,
      rateTiers: [],
    });
    await expect(
      service.update(outlet.id, {
        rateTiers: [{ durationHours: 2, rate: 80000 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.update(outlet.id, { pricingMode: 'duration' }),
    ).resolves.toMatchObject({ pricingMode: 'duration', happyHour: null });
    await expect(
      service.update(outlet.id, { pricingMode: 'happy_hour' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects malformed schedules and mixed modes in validated DTOs', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    const base = {
      name: 'Outlet',
      city: 'Jakarta',
      address: 'Street',
      rate: 100000,
    };
    const schedule = { days: [1, 5], startHour: 16, endHour: 19, rate: 60000 };
    for (const happyHour of [
      { ...schedule, days: [] },
      { ...schedule, days: [1, 1] },
      { ...schedule, days: [0] },
      { ...schedule, days: [8] },
      { ...schedule, days: ['1'] },
      { ...schedule, endHour: 16 },
      { ...schedule, endHour: 25 },
      { ...schedule, startHour: -1 },
      { ...schedule, rate: 0 },
      { ...schedule, rate: 1_000_000_001 },
      { ...schedule, extra: true },
    ]) {
      expect(
        await validate(
          plainToInstance(CreateOutletDto, {
            ...base,
            pricingMode: 'happy_hour',
            happyHour,
          }),
          options,
        ),
      ).not.toEqual([]);
    }
    expect(
      await validate(
        plainToInstance(CreateOutletDto, {
          ...base,
          pricingMode: 'happy_hour',
          happyHour: schedule,
        }),
        options,
      ),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(UpdateOutletDto, {
          pricingMode: 'happy_hour',
          happyHour: schedule,
        }),
        options,
      ),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(CreateOutletDto, {
          ...base,
          pricingMode: 'duration',
          happyHour: null,
        }),
        options,
      ),
    ).toEqual([]);
    const { service } = createService();
    await expect(
      service.create({ ...base, happyHour: schedule }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.create({
        ...base,
        pricingMode: 'happy_hour',
        happyHour: schedule,
        rateTiers: [{ durationHours: 2, rate: 80000 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('validates ordered tiers and strict pricing bounds on outlets', async () => {
    const valid = {
      name: 'Outlet',
      city: 'Jakarta',
      address: 'Jalan',
      rate: 100000,
    };
    const options = { whitelist: true, forbidNonWhitelisted: true };
    const validateCreate = (rateTiers: unknown) =>
      validate(
        plainToInstance(CreateOutletDto, { ...valid, rateTiers }),
        options,
      );
    for (const rateTiers of [
      [
        { durationHours: 2, rate: 80000 },
        { durationHours: 2, rate: 70000 },
      ],
      [
        { durationHours: 3, rate: 80000 },
        { durationHours: 2, rate: 70000 },
      ],
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
    expect(
      await validateCreate([
        { durationHours: 2, rate: 80000 },
        { durationHours: 10, rate: 50000 },
      ]),
    ).toEqual([]);
    expect(
      await validate(plainToInstance(CreateOutletDto, { ...valid, rate: 0 })),
    ).not.toEqual([]);
    expect(await validate(plainToInstance(UpdateOutletDto, {}))).toEqual([]);
    expect(
      await validate(plainToInstance(UpdateOutletDto, { rateTiers: [] })),
    ).toEqual([]);
    expect(
      await validate(plainToInstance(UpdateOutletDto, { rateTiers: null })),
    ).not.toEqual([]);
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

  it('archives an unused outlet, clears its photo, and deletes the file only after save', async () => {
    const { repository, photos, service } = createService();
    const outlet = {
      id: 'outlet-1',
      isActive: true,
      archivedAt: null,
      photo: oldUrl,
    };
    repository.findOneBy.mockResolvedValue(outlet);
    repository.query
      .mockResolvedValueOnce([{ hasTables: false }])
      .mockResolvedValueOnce([{ hasBookings: false }]);
    repository.save.mockImplementation(async (value: OutletEntity) => {
      expect(value.photo).toBeNull();
      expect(photos.remove).not.toHaveBeenCalled();
      return value;
    });

    await service.archive('outlet-1');

    expect(outlet.isActive).toBe(false);
    expect(outlet.archivedAt).toBeInstanceOf(Date);
    expect(repository.save).toHaveBeenCalledWith(outlet);
    expect(outlet.photo).toBeNull();
    expect(photos.remove).toHaveBeenCalledExactlyOnceWith(oldUrl, 'outlets');
  });

  it('keeps the old photo file when archive persistence fails', async () => {
    const { repository, photos, service } = createService();
    repository.findOneBy.mockResolvedValue(existingOutlet());
    repository.query
      .mockResolvedValueOnce([{ hasTables: false }])
      .mockResolvedValueOnce([{ hasBookings: false }]);
    const failure = new Error('database failed');
    repository.save.mockRejectedValue(failure);
    await expect(service.archive('outlet-1')).rejects.toBe(failure);
    expect(photos.remove).not.toHaveBeenCalled();
  });

  it('does not fail a committed archive when photo cleanup fails', async () => {
    const { repository, photos, service } = createService();
    repository.findOneBy.mockResolvedValue(existingOutlet());
    repository.query
      .mockResolvedValueOnce([{ hasTables: false }])
      .mockResolvedValueOnce([{ hasBookings: false }]);
    repository.save.mockImplementation(async (value: OutletEntity) => value);
    photos.remove.mockRejectedValue(new Error('cleanup failed'));
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await expect(service.archive('outlet-1')).resolves.toBeUndefined();
      expect(photos.remove).toHaveBeenCalledExactlyOnceWith(oldUrl, 'outlets');
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
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
