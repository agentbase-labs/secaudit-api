import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../../config/config.service';
import type { CurrentUserData } from '../../../common/decorators/current-user.decorator';

export interface AccessTokenPayload {
  sub: string;
  role: string;
  emailVerified: boolean;
  jti?: string;
  iat?: number;
  exp?: number;
  email?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(cfg: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: cfg.get('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<CurrentUserData> {
    return {
      id: payload.sub,
      email: payload.email ?? '',
      role: payload.role,
      emailVerified: payload.emailVerified,
      jti: payload.jti,
    };
  }
}
