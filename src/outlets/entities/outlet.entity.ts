import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { RateTierDto } from '../dto/rate-tier.dto.js';
import type { HappyHourDto } from '../dto/happy-hour.dto.js';

/** Persisted outlet location and operational status. */
@Entity({ name: 'outlets' })
export class OutletEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 80 })
  city!: string;

  @Column({ type: 'varchar', length: 240 })
  address!: string;

  @Column({ type: 'varchar', length: 64, default: 'Asia/Jakarta' })
  timezone!: string;

  @Column({ name: 'hourly_rate_idr', type: 'bigint', default: 75000 })
  hourlyRateIdr!: string;

  @Column({ name: 'rate_tiers', type: 'jsonb', default: () => "'[]'::jsonb" })
  rateTiers!: RateTierDto[];

  @Column({ name: 'pricing_mode', type: 'varchar', length: 10, default: 'duration' })
  pricingMode!: 'duration' | 'happy_hour';

  @Column({ name: 'happy_hour', type: 'jsonb', nullable: true })
  happyHour!: HappyHourDto | null;

  @Column({ name: 'opening_hour', type: 'smallint', default: 12 })
  openingHour!: number;

  @Column({ name: 'closing_hour', type: 'smallint', default: 22 })
  closingHour!: number;

  @Column({ type: 'varchar', length: 7, default: 'public' })
  visibility!: 'public' | 'private';

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
