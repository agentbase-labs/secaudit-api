import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Phase 1.5 stub. There are no orgs / invites in MVP — every user is
 * their own seat — so this guard always passes. Wired now to keep the
 * call-sites stable when invitations ship.
 */
@Injectable()
export class SeatsGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return true;
  }
}
