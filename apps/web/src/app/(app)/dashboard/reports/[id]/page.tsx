'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDownloadReportUrl, useMyReport } from '@/lib/hooks/use-reports';

/**
 * Client-facing report detail.
 *
 * Per the locked PDF Password Policy (2026-05-09) the password is always
 * visible to the report owner in the portal — every server-side fetch of
 * this page is audit-logged as `report.password.viewed`.
 */
export default function ClientReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useMyReport(id);
  const download = useDownloadReportUrl(id);

  function copyPassword() {
    if (!data?.password) return;
    void navigator.clipboard.writeText(data.password);
    toast.success('Password copied to clipboard');
  }

  async function onDownload() {
    try {
      const res = await download.mutateAsync();
      window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const sizeMb = (Number(data.fileSize) / 1024 / 1024).toFixed(2);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your security report</h1>
        <p className="text-muted-foreground text-sm">
          Report <code>{data.id}</code> · request{' '}
          <Link className="underline" href={`/dashboard/requests/${data.requestId}`}>
            <code>{data.requestId}</code>
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>PDF password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.password ? (
            <>
              <div className="flex items-center gap-2">
                <code className="bg-muted block w-full rounded-md px-3 py-2 font-mono text-base tracking-wider">
                  {data.password}
                </code>
                <Button variant="outline" onClick={copyPassword}>
                  Copy
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Use this password to open the encrypted PDF. Every view of this page is
                audit-logged.
              </p>
            </>
          ) : (
            <p className="text-destructive text-sm">
              Your password is not yet available. Please check the email we sent, or contact
              support.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Download</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            Encrypted PDF · {sizeMb} MB · uploaded{' '}
            {new Date(data.uploadedAt).toLocaleString()}
          </p>
          <p className="text-muted-foreground text-xs">
            Downloads so far: {data.downloadCount}
            {data.lastDownloadedAt
              ? ` · last ${new Date(data.lastDownloadedAt).toLocaleString()}`
              : ''}
          </p>
          <Button onClick={onDownload} disabled={download.isPending}>
            {download.isPending ? 'Preparing…' : 'Download encrypted PDF'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
