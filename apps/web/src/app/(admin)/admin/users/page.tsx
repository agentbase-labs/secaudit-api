'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useAdminUsers } from '@/lib/hooks/use-admin-users';

export default function AdminUsersPage() {
  const [q, setQ] = useState('');
  const { data, isLoading, error } = useAdminUsers(q ? { q } : undefined);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <Input
        placeholder="Search by email…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />
      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}

      <div className="grid gap-3">
        {data?.items.map((u) => (
          <Card key={u.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{u.email}</div>
                <div className="text-muted-foreground text-xs">
                  {u.fullName}
                  {u.companyName ? ` · ${u.companyName}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role}</Badge>
                {u.disabled && <Badge variant="destructive">disabled</Badge>}
                {!u.emailVerified && <Badge variant="outline">unverified</Badge>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
