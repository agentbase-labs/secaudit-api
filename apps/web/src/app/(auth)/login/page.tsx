'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { LoginSchema, type LoginInput } from '@cs-platform/shared';
import { loginRequest } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { en } from '@/i18n/en';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/dashboard';
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await loginRequest(values.email, values.password);
      toast.success(`Welcome, ${res.user.fullName}`);
      router.replace(next.startsWith('/') ? next : '/dashboard');
    } catch (e) {
      const err = e as { code?: string; message: string };
      if (err.code === 'email_not_verified') {
        toast.error('Email not verified. Check your inbox or request a new link.');
      } else {
        toast.error(err.message);
      }
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{en.auth.loginTitle}</CardTitle>
        <CardDescription>Sign in to your account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">{en.common.email}</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            {errors.email && <p className="text-destructive text-sm">{errors.email.message}</p>}
          </div>
          <div>
            <Label htmlFor="password">{en.common.password}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
            />
            {errors.password && (
              <p className="text-destructive text-sm">{errors.password.message}</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <Link href="/forgot-password" className="underline">
              Forgot password?
            </Link>
            <Link href="/register" className="underline">
              Create account
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <CardHeader>
            <CardTitle>{en.auth.loginTitle}</CardTitle>
            <CardDescription>Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Loading…</p>
          </CardContent>
        </Card>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
