'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ContactSchema, type ContactInput } from '@cs-platform/shared';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ContactPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactInput>({ resolver: zodResolver(ContactSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await apiFetch('/public/contact', { method: 'POST', body: values, skipAuth: true });
      setSent(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  return (
    <main className="container max-w-lg py-16">
      <Card>
        <CardHeader>
          <CardTitle>Contact us</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm">Thanks — we&apos;ll get back to you shortly.</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" {...register('name')} />
                {errors.name && <p className="text-destructive text-sm">{errors.name.message}</p>}
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register('email')} />
                {errors.email && <p className="text-destructive text-sm">{errors.email.message}</p>}
              </div>
              <div>
                <Label htmlFor="companyName">Company (optional)</Label>
                <Input id="companyName" {...register('companyName')} />
              </div>
              <div>
                <Label htmlFor="message">Message</Label>
                <textarea
                  id="message"
                  rows={5}
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...register('message')}
                />
                {errors.message && (
                  <p className="text-destructive text-sm">{errors.message.message}</p>
                )}
              </div>
              <Button disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Sending…' : 'Send'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
