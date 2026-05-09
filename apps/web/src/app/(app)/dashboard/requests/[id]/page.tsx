'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRequest } from '@/lib/hooks/use-requests';

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useRequest(id);

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {data.assetType} — {data.testingType}
        </h1>
        <Badge variant="secondary">{data.status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted overflow-auto rounded-md p-3 text-xs">
            {JSON.stringify(data.details, null, 2)}
          </pre>
          <p className="text-muted-foreground mt-2 text-xs">
            Created {new Date(data.createdAt).toLocaleString()}
          </p>
        </CardContent>
      </Card>

      {data.reports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Uploaded {new Date(data.reports[0]!.uploadedAt).toLocaleString()} — downloads:{' '}
              {data.reports[0]!.downloadCount}
            </p>
            <p className="text-muted-foreground text-xs">
              Your PDF password is shown on the report page (and was emailed to you in a
              separate message).
            </p>
            <div className="flex gap-2">
              <Button onClick={() => router.push(`/dashboard/reports/${data.reports[0]!.id}`)}>
                Open report
              </Button>
              <Link
                className="text-muted-foreground self-center text-xs underline"
                href={`/dashboard/reports/${data.reports[0]!.id}`}
              >
                View password & download
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
