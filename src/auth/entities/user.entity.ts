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
  role!: 'customer' | 'owner';

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;
}
