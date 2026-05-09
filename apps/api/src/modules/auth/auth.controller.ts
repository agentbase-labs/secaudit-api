import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApiErrorCodes } from '@cs-platform/shared';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { ForgotPasswordDto, ResendVerificationDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

const REFRESH_COOKIE = 'refreshToken';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  // -------- Public endpoints --------

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register({
      fullName: dto.fullName,
      email: dto.email,
      password: dto.password,
      companyName: dto.companyName,
      ip: req.ip ?? null,
    });
    if (result.autoLogin) {
      // Email verification disabled → register-and-sign-in. Issue the
      // refresh cookie + return the same shape as /auth/login so the
      // frontend can redirect straight to the dashboard.
      setRefreshCookie(res, result.tokens.refreshToken, result.tokens.refreshExpiresAt);
      return {
        userId: result.userId,
        accessToken: result.tokens.accessToken,
        user: result.user,
      };
    }
    return { userId: result.userId, message: 'Verification email sent' };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
    return { message: 'verified' };
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.auth.resendVerification(dto.email);
    return { message: 'if the account exists, an email was sent' };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login({
      email: dto.email,
      password: dto.password,
      ip: req.ip ?? null,
    });
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    return { accessToken: tokens.accessToken, user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!cookie) {
      throw new UnauthorizedException({
        error: ApiErrorCodes.REFRESH_INVALID,
        message: 'Missing refresh token',
      });
    }
    const { user, ...tokens } = await this.auth.refresh(cookie);
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    return { accessToken: tokens.accessToken, user };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'if the account exists, an email was sent' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { message: 'updated' };
  }

  // -------- Authenticated --------

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: CurrentUserData,
  ) {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    await this.auth.logout(cookie, user.id);
    res.clearCookie(REFRESH_COOKIE, refreshCookieBaseOptions());
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: CurrentUserData) {
    const u = await this.users.requireById(user.id);
    return this.users.toPublic(u);
  }
}

/**
 * Cookie attributes shared by `set` and `clear`. In production we accept a
 * cross-site cookie (api.<apex> ↔ <apex>) by setting `SameSite=None;
 * Secure` and an explicit `Domain=.<apex>` (via COOKIE_DOMAIN). In dev we
 * keep `SameSite=Strict` since both ends share `localhost`.
 */
function refreshCookieBaseOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN?.trim() || undefined;
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'strict') as 'none' | 'strict',
    path: '/api/v1/auth',
    domain: cookieDomain,
  };
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    ...refreshCookieBaseOptions(),
    expires: expiresAt,
  });
}
