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
import { User } from '../../users/entities/user.entity';

/**
 * UsageCounter = per-user, per-month rolling counters for cap enforcement
 * + display ("you've used 3/10 submissions this month").
 *
 * Keyed by (userId, periodStart) — new month = new row, no UPDATE needed
 * for "reset". Old rows stay forever as historical record.
 *
 * `manualPentestsCountYtd` is a denormalized cache (display only); cap
 * enforcement runs a live `COUNT(*)` against testing_requests filtered by year.
 */
@Entity('usage_counters')
@Index('ux_usage_user_period', ['userId', 'periodStart'], { unique: true })
export class UsageCounter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  /** First instant of the UTC month this counter belongs to. */
  @Column({ type: 'timestamptz' })
  periodStart!: Date;

  @Column({ type: 'int', default: 0 })
  submissionsCount!: number;

  @Column({ type: 'int', default: 0 })
  sourceReviewsCount!: number;

  @Column({ type: 'int', default: 0 })
  manualPentestsCountYtd!: number;

  /** Active/Deep scans consumed this period (active-scan monthly quota). */
  @Column({ type: 'int', default: 0 })
  activeScansCount!: number;

  /** bigint round-trips as string in node-pg. */
  @Column({ type: 'bigint', default: 0 })
  mobileUploadBytesUsed!: string;

  @Column({ type: 'timestamptz' })
  lastResetAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
