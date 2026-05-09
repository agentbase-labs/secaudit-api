'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMyRequests } from '@/lib/hooks/use-requests';

export default function DashboardPage() {
  const { data, isLoading, error } = useMyRequests();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your requests</h1>
        <Link href="/dashboard/requests/new">
          <Button>New request</Button>
        </Link>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}

      <div className="grid gap-4">
        {data?.items.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-muted-foreground">No requests yet.</p>
              <Link href="/dashboard/requests/new" className="mt-4 inline-block">
                <Button>Submit your first request</Button>
              </Link>
            </CardContent>
          </Card>
        )}
        {data?.items.map((r) => (
          <Link key={r.id} href={`/dashboard/requests/${r.id}`}>
            <Card className="hover:border-primary/50 transition">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>
                    {r.assetType} — {r.testingType}
                  </span>
                  <Badge variant="secondary">{r.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">
                {r.hasReport && <Badge className="mr-2">Report ready</Badge>}
                <span>Created {new Date(r.createdAt).toLocaleString()}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
