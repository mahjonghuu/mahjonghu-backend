import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Persisted reservation with immutable price and duration snapshots. */
@Entity({ name: 'bookings' })
export class BookingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40, unique: true })
  reference!: string;

  @Column({ name: 'outlet_id', type: 'uuid' })
  outletId!: string;

  @Column({ name: 'table_id', type: 'uuid' })
  tableId!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 120 })
  customerName!: string;

  @Column({ name: 'customer_contact', type: 'varchar', length: 160 })
  customerContact!: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  @Column({ name: 'duration_hours', type: 'integer' })
  durationHours!: number;

  @Column({ name: 'hourly_rate_idr', type: 'bigint' })
  hourlyRateIdr!: string;

  @Column({ name: 'total_amount_idr', type: 'bigint' })
  totalAmountIdr!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'expired';

  @Column({ name: 'hold_expires_at', type: 'timestamptz', nullable: true })
  holdExpiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
