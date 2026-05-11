import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PlanSlug, PublicPlan } from '@cs-platform/shared';

import { Plan } from './entities/plan.entity';

/** Plain CRUD on the `plans` table. */
@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan) private readonly repo: Repository<Plan>,
  ) {}

  async listPublic(): Promise<PublicPlan[]> {
    const rows = await this.repo.find({
      where: { isPublic: true },
      order: { sortOrder: 'ASC' },
    });
    return rows.map(toPublic);
  }

  async findById(id: string): Promise<Plan | null> {
    return this.repo.findOne({ where: { id } });
  }

  async requireById(id: string): Promise<Plan> {
    const p = await this.findById(id);
    if (!p) {
      throw new NotFoundException({ error: 'plan_not_found', message: `Plan ${id} not found` });
    }
    return p;
  }
}

export function toPublic(plan: Plan): PublicPlan {
  return {
    id: plan.id as PlanSlug,
    name: plan.name,
    monthlyPriceUsdCents: plan.monthlyPriceUsdCents,
    annualPriceUsdCents: plan.annualPriceUsdCents,
    isPublic: plan.isPublic,
    sortOrder: plan.sortOrder,
    caps: plan.caps,
  };
}
