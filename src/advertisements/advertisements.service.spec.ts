import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
import type { SupabaseImageStorage } from '../common/storage/supabase-image.storage.js';
import { AdvertisementsService } from './advertisements.service.js';
import type { CreateAdvertisementDto } from './dto/create-advertisement.dto.js';
import type { UpdateAdvertisementDto } from './dto/update-advertisement.dto.js';
import type { AdvertisementEntity } from './entities/advertisement.entity.js';

const id = '67ea73b8-a1a5-4e52-a73d-a0c8afbb91b8';
const previousUrl =
  'https://storage.example/advertisement-images/advertisements/old.png';
const uploadedUrl =
  'https://storage.example/advertisement-images/advertisements/new.png';
const image = 'data:image/png;base64,iVBORw0KGgo=';
const input: CreateAdvertisementDto = {
  title: '  Open tournament  ',
  image,
  startsOn: '2026-10-30',
  endsOn: '2026-10-30',
};

function setup() {
  const events: string[] = [];
  const previous: AdvertisementEntity = {
    id,
    title: 'Previous',
    imageUrl: previousUrl,
    startsOn: '2026-10-30',
    endsOn: '2026-11-02',
    createdAt: new Date('2026-10-20T00:00:00Z'),
    updatedAt: new Date('2026-10-20T00:00:00Z'),
  };
  const repository = {
    create: vi.fn((row: Partial<AdvertisementEntity>) => row),
    save: vi.fn(async (row: Partial<AdvertisementEntity>) => {
      events.push('save');
      return { ...previous, ...row };
    }),
    findOne: vi.fn(async () => previous),
    find: vi.fn(async () => [previous]),
    delete: vi.fn(async () => {
      events.push('delete');
      return { affected: 1 };
    }),
  };
  const manager = {
    getRepository: () => repository,
  } as unknown as EntityManager;
  const transaction = vi.fn(
    async (work: (manager: EntityManager) => Promise<unknown>) => {
      const result = await work(manager);
      events.push('commit');
      return result;
    },
  );
  const images = {
    upload: vi.fn(async () => {
      events.push('upload');
      return uploadedUrl;
    }),
    remove: vi.fn(async (url: string) => {
      events.push(`remove:${url}`);
    }),
  };
  const service = new AdvertisementsService(
    {
      ...repository,
      manager: { transaction },
    } as unknown as Repository<AdvertisementEntity>,
    images as unknown as SupabaseImageStorage,
  );
  return {
    service,
    repository,
    images,
    transaction,
    manager,
    previous,
    events,
  };
}

describe('AdvertisementsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T05:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('trims titles, permits a same-day active schedule and persists only the image URL', async () => {
    const { service, repository, images, events } = setup();
    expect(await service.create(input)).toEqual({
      id,
      title: 'Open tournament',
      imageUrl: uploadedUrl,
      startsOn: '2026-10-30',
      endsOn: '2026-10-30',
      status: 'active',
    });
    expect(images.upload).toHaveBeenCalledWith(image, 'advertisements');
    expect(repository.save.mock.calls[0][0]).not.toHaveProperty('image');
    expect(events).toEqual(['upload', 'save', 'commit']);
  });

  it.each([
    { title: '   ' },
    { title: 'x'.repeat(81) },
    { title: null },
    { startsOn: '2026-02-29' },
    { endsOn: '2026-04-31' },
    { startsOn: '2026-10-31' },
    { endsOn: null },
    { image: null },
    { image: undefined },
    { image: '' },
  ])(
    'rejects invalid create input before uploads or writes: %j',
    async (patch) => {
      const { service, repository, images, transaction } = setup();
      await expect(
        service.create({ ...input, ...patch } as CreateAdvertisementDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
      expect(images.upload).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it('does not save when Storage rejects an invalid image', async () => {
    const { service, repository, images } = setup();
    const error = new BadRequestException('Invalid image signature.');
    images.upload.mockRejectedValueOnce(error);
    await expect(service.create(input)).rejects.toBe(error);
    expect(repository.save).not.toHaveBeenCalled();
    expect(images.remove).not.toHaveBeenCalled();
  });

  it('compensates new uploads after a failed save without deleting the previous image', async () => {
    const { service, repository, images } = setup();
    const failure = new Error('database save failed');
    repository.save.mockRejectedValueOnce(failure);
    await expect(service.update(id, { image })).rejects.toBe(failure);
    expect(images.remove).toHaveBeenCalledExactlyOnceWith(
      uploadedUrl,
      'advertisements',
    );
  });

  it('compensates create uploads even when transaction commit fails after save', async () => {
    const { service, images, transaction, manager } = setup();
    const failure = new Error('commit failed');
    transaction.mockImplementationOnce(async (work) => {
      await work(manager);
      throw failure;
    });
    await expect(service.create(input)).rejects.toBe(failure);
    expect(images.remove).toHaveBeenCalledExactlyOnceWith(
      uploadedUrl,
      'advertisements',
    );
  });

  it('retains an omitted image and validates the merged partial schedule', async () => {
    const { service, images, repository } = setup();
    expect(
      await service.update(id, { title: ' New title ', endsOn: '2026-10-30' }),
    ).toMatchObject({
      title: 'New title',
      imageUrl: previousUrl,
      status: 'active',
    });
    expect(images.upload).not.toHaveBeenCalled();
    expect(images.remove).not.toHaveBeenCalled();
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    repository.save.mockClear();
    await expect(
      service.update(id, { startsOn: '2026-11-03' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
    expect(images.upload).not.toHaveBeenCalled();
  });

  it.each([
    { image: null },
    { title: null },
    { startsOn: null },
    { endsOn: '2026-2-01' },
  ])('rejects invalid partial edits without a write: %j', async (patch) => {
    const { service, images, repository } = setup();
    await expect(
      service.update(id, patch as UpdateAdvertisementDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
    expect(images.upload).not.toHaveBeenCalled();
  });

  it('deletes replaced images only after the replacement transaction commits', async () => {
    const { service, events } = setup();
    await service.update(id, { image });
    expect(events).toEqual([
      'upload',
      'save',
      'commit',
      `remove:${previousUrl}`,
    ]);
  });

  it('keeps committed replacements successful and logs only a sanitized cleanup warning', async () => {
    const { service, images } = setup();
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    images.remove.mockRejectedValueOnce(
      new Error('secret-key private-url image-bytes'),
    );
    await expect(service.update(id, { image })).resolves.toMatchObject({
      imageUrl: uploadedUrl,
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Advertisement image cleanup failed.',
    );
  });

  it('preserves the original database error when compensating cleanup also fails', async () => {
    const { service, repository, images } = setup();
    const failure = new Error('save failed');
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    repository.save.mockRejectedValueOnce(failure);
    images.remove.mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(service.create(input)).rejects.toBe(failure);
  });

  it('deletes the image after the database deletion commits, not before', async () => {
    const { service, events } = setup();
    await service.remove(id);
    expect(events).toEqual(['delete', 'commit', `remove:${previousUrl}`]);
  });

  it('retains the existing image when database deletion fails', async () => {
    const { service, repository, images } = setup();
    const failure = new Error('delete failed');
    repository.delete.mockRejectedValueOnce(failure);
    await expect(service.remove(id)).rejects.toBe(failure);
    expect(images.remove).not.toHaveBeenCalled();
  });

  it('does not report committed deletion as failure when Storage cleanup fails', async () => {
    const { service, images } = setup();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    images.remove.mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(service.remove(id)).resolves.toBeUndefined();
  });

  it('returns 404 without an upload for a missing update target', async () => {
    const { service, repository, images } = setup();
    repository.findOne.mockResolvedValueOnce(
      null as unknown as AdvertisementEntity,
    );
    await expect(service.update(id, { image })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(images.upload).not.toHaveBeenCalled();
  });

  it('derives inclusive status on both sides of Jakarta midnight without timestamp drift', async () => {
    const { service, previous } = setup();
    previous.endsOn = '2026-10-30';
    for (const [instant, status] of [
      ['2026-10-29T16:59:59.999Z', 'scheduled'],
      ['2026-10-29T17:00:00.000Z', 'active'],
      ['2026-10-30T16:59:59.999Z', 'active'],
      ['2026-10-30T17:00:00.000Z', 'expired'],
    ]) {
      vi.setSystemTime(new Date(instant));
      expect((await service.findAll())[0]).toMatchObject({
        startsOn: '2026-10-30',
        endsOn: '2026-10-30',
        status,
      });
    }
  });
});
