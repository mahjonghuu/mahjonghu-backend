import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @Column({ name: 'opening_hour', type: 'smallint', default: 12 })
  openingHour!: number;

  @Column({ name: 'closing_hour', type: 'smallint', default: 22 })
  closingHour!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
