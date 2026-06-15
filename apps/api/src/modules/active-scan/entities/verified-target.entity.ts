import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { VerifiedTargetMethod, VerifiedTargetStatus } from '@cs-platform/shared';
import { User } from '../../users/entities/user.entity';

/**
 * VerifiedTarget = a user-owned domain that has (or is in the process of)
 * proving ownership for active scanning. The legal/safety keystone — no active
 * scan may run against a host without a `verified` (non-expired) row here.
 *
 * See ACTIVE_SCAN_DESIGN.md §3 / §4.1.
 */
@Entity('verified_targets')
@Index('ux_verified_targets_user_host', ['userId', 'hostname'], { unique: true })
@Index('ix_verified_targets_status', ['status'])
export class VerifiedTargetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  /** Normalized FQDN (lowercase, no scheme/port/path). */
  @Column({ type: 'varchar', length: 253 })
  hostname!: string;

  /** Raw token (the `secaudit-verify=` key disambiguates the record). */
  @Column({ type: 'varchar', length: 64 })
  token!: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: VerifiedTargetStatus;

  @Column({ type: 'varchar', length: 20, nullable: true })
  verifiedMethod!: VerifiedTargetMethod | null;

  @Column({ type: 'timestamptz' })
  tokenIssuedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastCheckedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
