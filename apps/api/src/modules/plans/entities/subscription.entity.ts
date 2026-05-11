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
import { SubscriptionStatus } from '@cs-platform/shared';
import type { BillingCycle } from '@cs-platform/shared';
import { User } from '../../users/entities/user.entity';
import { Plan } from './plan.entity';

/**
 * Subscription = the link between user and plan, plus billing-cycle / period state.
 *
 * Invariants enforced at the DB level (see migration):
 *  - At most ONE row per user with status='active'
 *    (partial unique index `ux_subs_user_active`).
 *  - Free subscription: billingCycle=null, currentPeriodEnd=null.
 *
 * Stripe-shape from day one — Phase 1.5 fills the stripe* columns; no schema break.
 */
@Entity('subscriptions')
@Index('ix_subs_user_status', ['userId', 'status'])
@Index('ix_subs_period_end', ['currentPeriodEnd'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'varchar', length: 32 })
  planId!: string;

  @ManyToOne(() => Plan, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'planId' })
  plan?: Plan;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    enumName: 'subscription_status_enum',
    default: SubscriptionStatus.ACTIVE,
  })
  status!: SubscriptionStatus;

  /**
   * billingCycle is nullable: Free has no cycle. Paid plans have monthly|annual.
   * The shared `BillingCycle` is a zod-derived literal union ('monthly' | 'annual')
   * so we store it as a varchar (no enumName collision with PCR).
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  billingCycle!: BillingCycle | null;

  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  /** Plan the user requested but isn't yet on (mirror of pending PCR for fast reads). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  requestedPlanId!: string | null;

  // Phase 1.5 — Stripe integration columns (nullable until billing ships)
  @Column({ type: 'varchar', length: 64, nullable: true })
  stripeCustomerId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  stripePriceId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  stripeSubscriptionId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
