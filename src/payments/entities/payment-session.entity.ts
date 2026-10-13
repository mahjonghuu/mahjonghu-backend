import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** A DOKU checkout for one or more atomically held booking sessions. */
@Entity({ name: 'payment_sessions' })
export class PaymentSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'invoice_number', type: 'varchar', length: 30, unique: true })
  invoiceNumber!: string;

  @Column({ type: 'varchar', length: 10 })
  environment!: 'dev' | 'prod';

  @Column({ type: 'varchar', length: 20 })
  status!: 'pending' | 'succeeded' | 'failed' | 'expired';

  @Column({ name: 'customer_name', type: 'varchar', length: 120 })
  customerName!: string;

  @Column({ name: 'customer_phone', type: 'varchar', length: 32 })
  customerPhone!: string;

  @Column({ name: 'customer_email', type: 'varchar', length: 254 })
  customerEmail!: string;

  @Column({ name: 'amount_idr', type: 'bigint' })
  amountIdr!: string;

  @Column({ name: 'checkout_url', type: 'text', nullable: true })
  checkoutUrl!: string | null;

  @Column({ name: 'doku_session_id', type: 'varchar', length: 160, nullable: true })
  dokuSessionId!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'notification_request_id', type: 'varchar', length: 128, nullable: true, unique: true })
  notificationRequestId!: string | null;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt!: Date | null;

  @Column({ name: 'reservation_needs_review', type: 'boolean', default: false })
  reservationNeedsReview!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
