import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  AutoScanFindingCounts,
  AutoScanRunStatus,
  AutoScanScores,
  ScannerOutcome,
} from '@cs-platform/shared';

@Entity('auto_scan_runs')
@Index('ix_auto_scan_runs_request', ['requestId'])
@Index('ix_auto_scan_runs_status_created', ['status', 'createdAt'])
export class AutoScanRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  requestId!: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: AutoScanRunStatus;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'integer', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  tier1Status!: Record<string, ScannerOutcome> | null;

  @Column({ type: 'jsonb', nullable: true })
  tier2Status!: Record<string, ScannerOutcome> | null;

  @Column({ type: 'jsonb', nullable: true })
  findingCounts!: AutoScanFindingCounts | null;

  @Column({ type: 'jsonb', nullable: true })
  scores!: AutoScanScores | null;

  @Column({ type: 'text', nullable: true })
  errorLog!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
