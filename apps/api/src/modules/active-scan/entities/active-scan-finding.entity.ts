import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AutoScanSeverity } from '@cs-platform/shared';
import { ActiveScanJobEntity } from './active-scan-job.entity';

/**
 * ActiveScanFinding = one normalized finding produced by the SkyNet worker.
 * Field names mirror the `findings.normalized.json` contract (§4.4); deduped
 * per job via the unique `(jobId, dedupKey)` index. On conflict the worker /
 * service keeps the highest severity (§4.4 mapping rule).
 *
 * SECURITY: every text field (title/description/evidence) is attacker-
 * influenceable (banners). Treat as untrusted — the web app renders as text,
 * never `dangerouslySetInnerHTML` (§10).
 */
@Entity('active_scan_findings')
@Index('ix_active_scan_findings_job', ['jobId'])
@Index('ix_active_scan_findings_job_sev', ['jobId', 'severity'])
@Index('ux_active_scan_findings_dedup', ['jobId', 'dedupKey'], { unique: true })
export class ActiveScanFindingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  jobId!: string;

  @ManyToOne(() => ActiveScanJobEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job?: ActiveScanJobEntity;

  /** sha1(host|port|source|check). */
  @Column({ type: 'varchar', length: 64 })
  dedupKey!: string;

  /** IP or hostname (max IPv6 length). */
  @Column({ type: 'varchar', length: 45 })
  host!: string;

  @Column({ type: 'integer', nullable: true })
  port!: number | null;

  /** smb|oracle|rdp|http|... */
  @Column({ type: 'varchar', length: 40, nullable: true })
  service!: string | null;

  /** e.g. 'smb-signing-disabled', 'nuclei:CVE-...'. */
  @Column({ type: 'varchar', length: 80 })
  check!: string;

  @Column({ type: 'varchar', length: 20 })
  severity!: AutoScanSeverity;

  /** SkyNetSource: nmap|masscan|nuclei|nxc|odat|snmp-check|httpx|module:<name>. */
  @Column({ type: 'varchar', length: 40 })
  source!: string;

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
