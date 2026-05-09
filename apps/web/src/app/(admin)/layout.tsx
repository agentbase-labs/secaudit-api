'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMe } from '@/lib/hooks/use-me';
import { AppShell } from '@/components/layout/AppShell';

export default function AdminGroupLayout({ children }: { children: ReactNode }) {
  const { data: me, isLoading, isError } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && (isError || me?.role !== 'admin')) {
      router.replace('/dashboard');
    }
  }, [isLoading, isError, me, router]);

  if (isLoading || !me) {
    return <div className="container py-10 text-muted-foreground">Loading…</div>;
  }
  if (me.role !== 'admin') return null;

  return <AppShell admin>{children}</AppShell>;
}
