import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TestingRequest } from '../../requests/entities/testing-request.entity';
import { User } from '../../users/entities/user.entity';

@Entity('reports')
@Index('ix_reports_request', ['requestId'])
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  requestId!: string;

  @ManyToOne(() => TestingRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requestId' })
  request?: TestingRequest;

  /**
   * R2 key for the **encrypted** PDF (qpdf AES-256, password-protected).
   * Always present. This is what clients download.
   */
  @Column()
  encryptedPdfR2Key!: string;

  /**
   * R2 key for the **plaintext** PDF (admin-only, never exposed to clients).
   * Used to re-encrypt with a fresh password when the admin regenerates it.
   * Nullable for legacy reports that pre-date the new flow.
   */
  @Column({ type: 'varchar', nullable: true })
  originalPdfR2Key!: string | null;

  @Column({ type: 'bigint' })
  fileSize!: string;

  /**
   * Legacy bcrypt(plaintext password). Kept (nullable) for backwards-compat
   * with reports created before the AES-GCM flow.
   */
  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

  /** AES-256-GCM ciphertext of the PDF password (base64). */
  @Column({ type: 'text', nullable: true })
  passwordCiphertext!: string | null;

  /** AES-256-GCM IV (base64, 12 bytes). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  passwordIv!: string | null;

  /** AES-256-GCM auth tag (base64, 16 bytes). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  passwordTag!: string | null;

  /** Timestamp of the most recent password generation/rotation. */
  @Column({ type: 'timestamptz', nullable: true })
  passwordCreatedAt!: Date | null;

  /** True when the PDF file itself is already password-encrypted. */
  @Column({ default: false })
  pdfSelfEncrypted!: boolean;

  @Column('uuid')
  uploadedBy!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uploadedBy' })
  uploader?: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'uploadedAt' })
  uploadedAt!: Date;

  @Column({ type: 'int', default: 0 })
  downloadCount!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastDownloadedAt!: Date | null;
}
