import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** One booking's contribution to an aggregate DOKU charge. */
@Entity({ name: 'payments' })
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId!: string;

  @Column({ name: 'payment_session_id', type: 'uuid', nullable: true })
  paymentSessionId!: string | null;

  @Column({ type: 'varchar', length: 10 })
  kind!: 'charge';

  @Column({ type: 'varchar', length: 10 })
  status!: 'pending' | 'succeeded' | 'failed';

  @Column({ name: 'amount_idr', type: 'bigint' })
  amountIdr!: string;

  @Column({ type: 'varchar', length: 80 })
  provider!: string;

  @Column({
    name: 'provider_reference',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  providerReference!: string | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 160,
    unique: true,
  })
  idempotencyKey!: string;

  @Column({ name: 'original_payment_id', type: 'uuid', nullable: true })
  originalPaymentId!: string | null;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
