import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PlanCaps } from '@cs-platform/shared';

/**
 * Plan = the static product tier (free/starter/pro/business/enterprise).
 * Slug PK chosen for stability + readability in JWTs/logs.
 * Caps live in JSONB so cap tweaks are seed/SQL changes, not migrations.
 */
@Entity('plans')
@Index('ix_plans_public_sort', ['isPublic', 'sortOrder'])
export class Plan {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'int' })
  monthlyPriceUsdCents!: number;

  @Column({ type: 'int' })
  annualPriceUsdCents!: number;

  @Column({ default: true })
  isPublic!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'jsonb' })
  caps!: PlanCaps;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
