import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  AutoScanCategory,
  AutoScanSeverity,
  AutoScanSource,
} from '@cs-platform/shared';

@Entity('auto_scan_findings')
@Index('ix_auto_scan_findings_request', ['requestId'])
@Index('ix_auto_scan_findings_scan', ['scanId'])
export class AutoScanFindingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  requestId!: string;

  @Column('uuid')
  scanId!: string;

  @Column({ type: 'varchar', length: 50 })
  source!: AutoScanSource;

  @Column({ type: 'varchar', length: 20 })
  severity!: AutoScanSeverity;

  @Column({ type: 'varchar', length: 50 })
  category!: AutoScanCategory;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  evidence!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  remediation!: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  referenceUrls!: string[];

  @Column({ type: 'boolean', default: false })
  promotedToReport!: boolean;

  @Column({ type: 'boolean', default: false })
  dismissed!: boolean;

  @Column({ type: 'text', nullable: true })
  dismissedReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
