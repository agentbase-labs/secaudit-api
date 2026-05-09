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
import { AssetType, RequestStatus, TestingType } from '@cs-platform/shared';
import type { RequestDetails } from '@cs-platform/shared';
import { User } from '../../users/entities/user.entity';

@Entity('testing_requests')
@Index('ix_tr_user_status', ['userId', 'status'])
@Index('ix_tr_status_created', ['status', 'createdAt'])
export class TestingRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'enum', enum: AssetType, enumName: 'asset_type_enum' })
  assetType!: AssetType;

  @Column({ type: 'enum', enum: TestingType, enumName: 'testing_type_enum' })
  testingType!: TestingType;

  @Column({
    type: 'enum',
    enum: RequestStatus,
    enumName: 'request_status_enum',
    default: RequestStatus.SUBMITTED,
  })
  status!: RequestStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  details!: RequestDetails | Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
