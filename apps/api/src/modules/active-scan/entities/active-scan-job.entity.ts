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
import type {
  ActiveScanFindingCounts,
  ActiveScanJobStatus,
  ActiveScanScope,
  SkyNetSummary,
} from '@cs-platform/shared';
import { User } from '../../users/entities/user.entity';
import { VerifiedTargetEntity } from './verified-target.entity';

/**
 * ActiveScanJob = one on-demand active/deep scan invocation against a verified
 * target. The API only validates, enqueues, and serves stored rows — scanning
 * happens in the isolated worker (ACTIVE_SCAN_DESIGN.md §2 / §4.2).
 *
 * Status lifecycle:
 *   queued → verifying → running → parsing → completed
 *                              ↘ failed
 *      (any non-terminal) ───── cancelled
 */
@Entity('active_scan_jobs')
@Index('ix_active_scan_jobs_user_status', ['userId', 'status'])
@Index('ix_active_scan_jobs_status_created', ['status', 'createdAt'])
@Index('ix_active_scan_jobs_target', ['targetId'])
export class ActiveScanJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column('uuid')
  targetId!: string;

  @ManyToOne(() => VerifiedTargetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'targetId' })
  target?: VerifiedTargetEntity;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status!: ActiveScanJobStatus;

  // ── Snapshots taken at request time (TOCTOU defense + audit immutability) ──
  @Column({ type: 'varchar', length: 253 })
  verifiedHost!: string;

  @Column({ type: 'varchar', length: 64 })
  verifyTokenSnapshot!: string;

  /** PlanSlug snapshot for audit (what tier the user was on at request time). */
  @Column({ type: 'varchar', length: 32 })
  planAtRequest!: string;

  /** Always 'saas' this phase. */
  @Column({ type: 'varchar', length: 20, default: 'saas' })
  profile!: string;

  /** The locked allowlist + caps the worker must honor. */
  @Column({ type: 'jsonb' })
  scope!: ActiveScanScope;

  // ── Worker coordination ──
  @Column({ type: 'varchar', length: 64, nullable: true })
  workerId!: string | null;

  @Column({ type: 'integer', default: 0 })
  progressPct!: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  currentPhase!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  queuedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'integer', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  findingCounts!: ActiveScanFindingCounts | null;

  @Column({ type: 'jsonb', nullable: true })
  summary!: SkyNetSummary | null;

  @Column({ type: 'text', nullable: true })
  errorReason!: string | null;

  @Column({ type: 'text', nullable: true })
  errorLog!: string | null;

  // ── ToS / authorization capture (legal evidence) ──
  @Column({ type: 'boolean', default: false })
  authorizationAccepted!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  authorizationVersion!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  requestIp!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
