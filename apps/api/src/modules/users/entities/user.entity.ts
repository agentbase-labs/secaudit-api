import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '@cs-platform/shared';

@Entity('users')
@Index('ux_users_email', ['email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 200 })
  fullName!: string;

  @Column({ type: 'citext', unique: true })
  email!: string;

  @Column({ length: 200, nullable: true, type: 'varchar' })
  companyName!: string | null;

  @Column()
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role_enum', default: UserRole.CLIENT })
  role!: UserRole;

  @Column({ default: false })
  emailVerified!: boolean;

  @Column({ default: false })
  disabled!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
