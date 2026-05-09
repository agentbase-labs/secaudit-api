'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ForgotPasswordSchema, type ForgotPasswordInput } from '@cs-platform/shared';
import { forgotPasswordRequest } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { en } from '@/i18n/en';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(ForgotPasswordSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await forgotPasswordRequest(values.email);
      setSent(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{en.auth.forgotTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p className="text-sm">
            If an account exists for that email, a reset link has been sent.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">{en.common.email}</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && <p className="text-destructive text-sm">{errors.email.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
