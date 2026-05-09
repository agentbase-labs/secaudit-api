import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
@Index('ix_rt_user', ['userId'])
@Index('ix_rt_family', ['family'])
@Index('ux_rt_jti', ['jti'], { unique: true })
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  /** Family id: stays constant across rotations. */
  @Column('uuid')
  family!: string;

  /** Unique jti per token; blacklisted on rotation. */
  @Column('uuid')
  jti!: string;

  @Column()
  tokenHash!: string;

  @Column({ type: 'uuid', nullable: true })
  replacedByJti!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
