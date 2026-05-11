import { Controller, Get, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { PlansService } from './plans.service';

/**
 * `GET /api/v1/public/plans` — public plan catalogue for the marketing
 * + signup pages. No auth, 5-minute browser cache.
 */
@Controller('public')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Public()
  @Get('plans')
  @Header('Cache-Control', 'public, max-age=300')
  @Throttle({ default: { limit: 60, ttl: 60 * 1000 } })
  async listPublic() {
    const plans = await this.plans.listPublic();
    return { plans };
  }
}
