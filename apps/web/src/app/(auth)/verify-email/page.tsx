'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { verifyEmailRequest } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { en } from '@/i18n/en';

type Status = 'verifying' | 'ok' | 'failed';

function VerifyEmailInner() {
  const [status, setStatus] = useState<Status>('verifying');
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const token = params.get('token');

  useEffect(() => {
    if (!token) {
      setStatus('failed');
      setError('Missing token');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await verifyEmailRequest(token);
        if (!cancelled) setStatus('ok');
      } catch (e) {
        if (!cancelled) {
          setStatus('failed');
          setError((e as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {status === 'verifying' && en.auth.verifyingEmail}
          {status === 'ok' && en.auth.verifySuccess}
          {status === 'failed' && en.auth.verifyFailed}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {status === 'failed' && error && <p className="text-destructive text-sm">{error}</p>}
        <Link href="/login">
          <Button>Go to login</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <CardHeader>
            <CardTitle>{en.auth.verifyingEmail}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Loading…</p>
          </CardContent>
        </Card>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
