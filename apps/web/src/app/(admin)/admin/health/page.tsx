'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function HealthPage() {
  const { data, isLoading, error } = useQuery<{ status: string } & Record<string, unknown>>({
    queryKey: ['system-health'],
    queryFn: () => apiFetch<{ status: string } & Record<string, unknown>>('/admin/system-health'),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">System health</h1>
      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}
      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="capitalize">
              Status: {data.status}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted overflow-auto rounded-md p-3 text-xs">
              {JSON.stringify(data, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
