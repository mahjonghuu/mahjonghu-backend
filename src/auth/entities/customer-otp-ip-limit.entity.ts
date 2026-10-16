import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'customer_otp_ip_limits' })
export class CustomerOtpIpLimitEntity {
  @PrimaryColumn({ name: 'ip_hash', type: 'varchar', length: 64 })
  ipHash!: string;

  @Column({ name: 'window_start', type: 'timestamptz' })
  windowStart!: Date;

  @Column({ name: 'request_count', type: 'smallint' })
  requestCount!: number;
}
