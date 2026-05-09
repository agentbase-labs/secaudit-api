import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import type { PublicUser } from '@cs-platform/shared';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  get repository(): Repository<User> {
    return this.repo;
  }

  async findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  async requireById(id: string): Promise<User> {
    const u = await this.findById(id);
    if (!u) throw new NotFoundException({ error: 'not_found', message: 'User not found' });
    return u;
  }

  async create(input: {
    fullName: string;
    email: string;
    companyName: string | null;
    passwordHash: string;
    emailVerified?: boolean;
  }): Promise<User> {
    const entity = this.repo.create({
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      companyName: input.companyName,
      passwordHash: input.passwordHash,
      ...(input.emailVerified !== undefined ? { emailVerified: input.emailVerified } : {}),
    });
    return this.repo.save(entity);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.repo.update(id, { passwordHash });
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.repo.update(id, { emailVerified: true });
  }

  toPublic(user: User): PublicUser {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      companyName: user.companyName,
      role: user.role,
      emailVerified: user.emailVerified,
      disabled: user.disabled,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
