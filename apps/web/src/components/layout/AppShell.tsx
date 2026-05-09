'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMe } from '@/lib/hooks/use-me';
import { logoutRequest } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { en } from '@/i18n/en';

export function AppShell({
  children,
  admin = false,
}: {
  children: ReactNode;
  admin?: boolean;
}) {
  const { data: me } = useMe();
  const router = useRouter();

  async function onLogout() {
    await logoutRequest();
    router.push('/login');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold">
              {en.brand}
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/dashboard">{en.nav.dashboard}</Link>
              {me?.role === 'admin' && <Link href="/admin">{en.nav.admin}</Link>}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {me && (
              <span className="text-muted-foreground text-sm">
                {me.fullName} {admin && '(admin)'}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={onLogout}>
              {en.nav.logout}
            </Button>
          </div>
        </div>
      </header>
      <main className="container flex-1 py-8">{children}</main>
    </div>
  );
}
