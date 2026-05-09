import { apiFetch, setAccessToken } from './api-client';
import type { PublicUser } from '@cs-platform/shared';

export interface LoginResult {
  accessToken: string;
  user: PublicUser;
}

export async function loginRequest(email: string, password: string): Promise<LoginResult> {
  const res = await apiFetch<LoginResult>('/auth/login', {
    method: 'POST',
    body: { email, password },
    skipAuth: true,
  });
  setAccessToken(res.accessToken);
  return res;
}

export async function logoutRequest(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
  } finally {
    setAccessToken(null);
  }
}

export async function meRequest(): Promise<PublicUser> {
  return apiFetch<PublicUser>('/auth/me');
}

export async function registerRequest(input: {
  fullName: string;
  email: string;
  password: string;
  companyName?: string;
}): Promise<{ userId: string; message: string }> {
  return apiFetch('/auth/register', { method: 'POST', body: input, skipAuth: true });
}

export async function verifyEmailRequest(token: string): Promise<void> {
  await apiFetch('/auth/verify-email', { method: 'POST', body: { token }, skipAuth: true });
}

export async function forgotPasswordRequest(email: string): Promise<void> {
  await apiFetch('/auth/forgot-password', { method: 'POST', body: { email }, skipAuth: true });
}

export async function resetPasswordRequest(token: string, password: string): Promise<void> {
  await apiFetch('/auth/reset-password', {
    method: 'POST',
    body: { token, password },
    skipAuth: true,
  });
}
