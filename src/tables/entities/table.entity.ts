import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Persisted mahjong table; occupancy is derived from active bookings. */
@Entity({ name: 'mahjong_tables' })
export class TableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'outlet_id', type: 'uuid' })
  outletId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ name: 'hourly_rate_idr', type: 'bigint' })
  hourlyRateIdr!: string;

  @Column({ type: 'varchar', length: 20, default: 'available' })
  condition!: 'available' | 'maintenance';

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
