import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'customer_otp' })
export class CustomerOtpEntity {
  @PrimaryColumn({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ name: 'code_hash', type: 'varchar', length: 64 })
  codeHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'last_sent_at', type: 'timestamptz' })
  lastSentAt!: Date;

  @Column({ name: 'window_start', type: 'timestamptz' })
  windowStart!: Date;

  @Column({ name: 'request_count', type: 'smallint' })
  requestCount!: number;

  @Column({ name: 'failed_attempts', type: 'smallint' })
  failedAttempts!: number;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
