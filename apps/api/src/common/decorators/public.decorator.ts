import { SetMetadata } from '@nestjs/common';

/** Marks an endpoint as public (bypasses JwtAuthGuard when used globally). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
