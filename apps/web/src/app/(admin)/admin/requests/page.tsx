'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useAdminRequests } from '@/lib/hooks/use-admin-requests';

export default function AdminRequestsPage() {
  const [q, setQ] = useState('');
  const { data, isLoading, error } = useAdminRequests(q ? { q } : undefined);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Requests</h1>
      <Input
        placeholder="Search by email or request id…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />
      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}

      <div className="grid gap-3">
        {data?.items.map((r) => (
          <Link key={r.id} href={`/admin/requests/${r.id}`}>
            <Card className="hover:border-primary/50 transition">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium">
                    {r.user.email} · {r.assetType}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {r.testingType} · {new Date(r.createdAt).toLocaleString()}
                  </div>
                </div>
                <Badge variant="secondary">{r.status}</Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
