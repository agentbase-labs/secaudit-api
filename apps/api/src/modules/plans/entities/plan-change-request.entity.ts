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
import { PlanChangeRequestStatus } from '@cs-platform/shared';
import type { BillingCycle } from '@cs-platform/shared';
import { User } from '../../users/entities/user.entity';
import { Plan } from './plan.entity';

/**
 * PlanChangeRequest = audit trail + admin queue for self-serve upgrades.
 *
 * Invariant: at most one row per user with status='pending'
 * (partial unique index `ux_pcr_user_pending`).
 * New requests supersede any prior pending one (service marks old as
 * rejected with note 'superseded' before inserting the new row).
 */
@Entity('plan_change_requests')
@Index('ix_pcr_status_created', ['status', 'createdAt'])
@Index('ix_pcr_user_created', ['userId', 'createdAt'])
export class PlanChangeRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'varchar', length: 32 })
  fromPlanId!: string;

  @ManyToOne(() => Plan, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fromPlanId' })
  fromPlan?: Plan;

  @Column({ type: 'varchar', length: 32 })
  toPlanId!: string;

  @ManyToOne(() => Plan, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'toPlanId' })
  toPlan?: Plan;

  /** Same shape as Subscription.billingCycle — varchar, not pg enum, to keep zod the source of truth. */
  @Column({ type: 'varchar', length: 16 })
  billingCycle!: BillingCycle;

  @Column({
    type: 'enum',
    enum: PlanChangeRequestStatus,
    enumName: 'plan_change_request_status_enum',
    default: PlanChangeRequestStatus.PENDING,
  })
  status!: PlanChangeRequestStatus;

  /** Admin decision notes (set on approve / reject). */
  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** Optional context the user supplied when submitting the change request. */
  @Column({ type: 'text', nullable: true })
  userNotes!: string | null;

  /** Timestamp when the user cancelled their own pending PCR. */
  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  processedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
