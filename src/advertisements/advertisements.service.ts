import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { SupabaseImageStorage } from '../common/storage/supabase-image.storage.js';
import {
  currentJakartaDate,
  isAdvertisementDate,
} from './advertisement-schedule.js';
import { CreateAdvertisementDto } from './dto/create-advertisement.dto.js';
import { UpdateAdvertisementDto } from './dto/update-advertisement.dto.js';
import { AdvertisementEntity } from './entities/advertisement.entity.js';

/** Public-safe advertisement projection, with status derived from the server's Jakarta date. */
export type AdvertisementRecord = {
  id: string;
  title: string;
  imageUrl: string;
  startsOn: string;
  endsOn: string;
  status: 'scheduled' | 'active' | 'expired';
};

/** Owns advertisement schedules and compensated Storage/database image lifecycles. */
@Injectable()
export class AdvertisementsService {
  private readonly logger = new Logger(AdvertisementsService.name);

  constructor(
    @InjectRepository(AdvertisementEntity)
    private readonly advertisements: Repository<AdvertisementEntity>,
    private readonly images: SupabaseImageStorage,
  ) {}

  /** Lists all owner advertisements, newest first with a stable UUID tie-breaker. */
  async findAll(): Promise<AdvertisementRecord[]> {
    const today = currentJakartaDate();
    const rows = await this.advertisements.find({
      order: { createdAt: 'DESC', id: 'ASC' },
    });
    return rows.map((row) => this.toRecord(row, today));
  }

  /** Reads only advertisements active on the current inclusive Jakarta calendar date. */
  async findPublic(): Promise<AdvertisementRecord[]> {
    const today = currentJakartaDate();
    const rows = await this.advertisements.find({
      where: {
        startsOn: LessThanOrEqual(today),
        endsOn: MoreThanOrEqual(today),
      },
      order: { createdAt: 'DESC', id: 'ASC' },
    });
    return rows.map((row) => this.toRecord(row, today));
  }

  /** Validates before uploading, stores only the URL, and compensates failed database commits. */
  async create(dto: CreateAdvertisementDto): Promise<AdvertisementRecord> {
    const title = this.validateTitle(dto.title);
    this.validateSchedule(dto.startsOn, dto.endsOn);
    this.validateImage(dto.image);
    let uploaded: string | undefined;
    let saved: AdvertisementEntity;
    try {
      saved = await this.advertisements.manager.transaction(async (manager) => {
        uploaded = await this.images.upload(dto.image, 'advertisements');
        const repository = manager.getRepository(AdvertisementEntity);
        return repository.save(
          repository.create({
            title,
            imageUrl: uploaded,
            startsOn: dto.startsOn,
            endsOn: dto.endsOn,
          }),
        );
      });
    } catch (error) {
      if (uploaded) await this.cleanupImage(uploaded);
      throw error;
    }
    return this.toRecord(saved, currentJakartaDate());
  }

  /** Merges partial schedules under a row lock; replaced objects are removed only after commit. */
  async update(
    id: string,
    dto: UpdateAdvertisementDto,
  ): Promise<AdvertisementRecord> {
    const title =
      dto.title === undefined ? undefined : this.validateTitle(dto.title);
    if (dto.image !== undefined) this.validateImage(dto.image);
    if (dto.startsOn !== undefined && !isAdvertisementDate(dto.startsOn)) {
      throw new BadRequestException(
        'startsOn must be a real date in YYYY-MM-DD format.',
      );
    }
    if (dto.endsOn !== undefined && !isAdvertisementDate(dto.endsOn)) {
      throw new BadRequestException(
        'endsOn must be a real date in YYYY-MM-DD format.',
      );
    }
    let uploaded: string | undefined;
    let previousImage: string | undefined;
    let saved: AdvertisementEntity;
    try {
      saved = await this.advertisements.manager.transaction(async (manager) => {
        const repository = manager.getRepository(AdvertisementEntity);
        const previous = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!previous) throw new NotFoundException('Advertisement not found.');
        const startsOn = dto.startsOn ?? previous.startsOn;
        const endsOn = dto.endsOn ?? previous.endsOn;
        this.validateSchedule(startsOn, endsOn);
        if (dto.image !== undefined) {
          uploaded = await this.images.upload(dto.image, 'advertisements');
          previousImage = previous.imageUrl;
        }
        return repository.save(
          repository.create({
            ...previous,
            title: title ?? previous.title,
            startsOn,
            endsOn,
            imageUrl: uploaded ?? previous.imageUrl,
          }),
        );
      });
    } catch (error) {
      if (uploaded) await this.cleanupImage(uploaded);
      throw error;
    }
    if (previousImage) await this.cleanupImage(previousImage);
    return this.toRecord(saved, currentJakartaDate());
  }

  /** Permanently removes the row before attempting best-effort Storage cleanup. */
  async remove(id: string): Promise<void> {
    const imageUrl = await this.advertisements.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(AdvertisementEntity);
        const advertisement = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!advertisement)
          throw new NotFoundException('Advertisement not found.');
        await repository.delete(id);
        return advertisement.imageUrl;
      },
    );
    await this.cleanupImage(imageUrl);
  }

  private validateTitle(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > 80
    ) {
      throw new BadRequestException('title must contain 1 to 80 characters.');
    }
    return value.trim();
  }

  private validateImage(value: unknown): void {
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException(
        'image must be a JPEG, PNG, or WebP data URL.',
      );
    }
  }

  private validateSchedule(startsOn: unknown, endsOn: unknown): void {
    if (!isAdvertisementDate(startsOn) || !isAdvertisementDate(endsOn)) {
      throw new BadRequestException(
        'Schedule dates must be real dates in YYYY-MM-DD format.',
      );
    }
    if (startsOn > endsOn) {
      throw new BadRequestException('startsOn must not be after endsOn.');
    }
  }

  private async cleanupImage(url: string): Promise<void> {
    try {
      await this.images.remove(url, 'advertisements');
    } catch {
      // Do not expose URLs, service credentials, image bytes, or provider errors in logs.
      this.logger.warn('Advertisement image cleanup failed.');
    }
  }

  private toRecord(
    row: AdvertisementEntity,
    today: string,
  ): AdvertisementRecord {
    return {
      id: row.id,
      title: row.title,
      imageUrl: row.imageUrl,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      status:
        today < row.startsOn
          ? 'scheduled'
          : today > row.endsOn
            ? 'expired'
            : 'active',
    };
  }
}
