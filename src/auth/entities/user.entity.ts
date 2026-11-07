import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  passwordHash!: string | null;

  @Column({ type: 'varchar', length: 10 })
  role!: 'customer' | 'owner' | 'employee';

  /** Outlet assigned to an employee; owners and customers keep this null. */
  @Column({ name: 'outlet_id', type: 'uuid', nullable: true })
  outletId!: string | null;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;
}
