'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { RegisterSchema, type RegisterInput } from '@cs-platform/shared';
import { registerRequest } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { en } from '@/i18n/en';

export default function RegisterPage() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(RegisterSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await registerRequest({
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        companyName: values.companyName || undefined,
      });
      toast.success('Check your email to verify your account.');
      router.push('/login');
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{en.auth.registerTitle}</CardTitle>
        <CardDescription>Start testing in minutes</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="fullName">{en.common.fullName}</Label>
            <Input id="fullName" {...register('fullName')} />
            {errors.fullName && (
              <p className="text-destructive text-sm">{errors.fullName.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="email">{en.common.email}</Label>
            <Input id="email" type="email" {...register('email')} />
            {errors.email && <p className="text-destructive text-sm">{errors.email.message}</p>}
          </div>
          <div>
            <Label htmlFor="companyName">{en.common.companyName} (optional)</Label>
            <Input id="companyName" {...register('companyName')} />
          </div>
          <div>
            <Label htmlFor="password">{en.common.password}</Label>
            <Input id="password" type="password" {...register('password')} />
            {errors.password && (
              <p className="text-destructive text-sm">{errors.password.message}</p>
            )}
            <p className="text-muted-foreground mt-1 text-xs">
              12+ characters, upper + lower + digit + symbol.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create account'}
          </Button>
          <p className="text-center text-sm">
            Already have an account?{' '}
            <Link href="/login" className="underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
