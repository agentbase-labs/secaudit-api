'use client';

import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RequestStatus } from '@cs-platform/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useAdminRequest, useUpdateStatus } from '@/lib/hooks/use-admin-requests';
import { useAdminUploadReport } from '@/lib/hooks/use-reports';

const PDF_MAX_BYTES = 50 * 1024 * 1024;

export default function AdminRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useAdminRequest(id);
  const updateStatus = useUpdateStatus(id);
  const upload = useAdminUploadReport(id);
  const [nextStatus, setNextStatus] = useState<RequestStatus | ''>('');
  const [progress, setProgress] = useState<number>(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onUpdateStatus() {
    if (!nextStatus) return;
    try {
      await updateStatus.mutateAsync({ status: nextStatus });
      toast.success(`Status → ${nextStatus}`);
      setNextStatus('');
      void refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error('Pick a PDF first');
      return;
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast.error('File must be a PDF');
      return;
    }
    if (file.size > PDF_MAX_BYTES) {
      toast.error('PDF exceeds 50MB limit');
      return;
    }
    setProgress(0);
    try {
      const res = await upload.mutateAsync({ file, onProgress: setProgress });
      toast.success('Report uploaded — password sent to client via email');
      router.push(`/admin/reports/${res.reportId}`);
    } catch (err) {
      toast.error((err as Error).message);
      setProgress(0);
    }
  }

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const hasReport = data.hasReport;
  const canUpload = !hasReport && data.status !== RequestStatus.COMPLETED;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {data.assetType} — {data.testingType}
          </h1>
          <p className="text-muted-foreground text-sm">
            {data.user.email} · created {new Date(data.createdAt).toLocaleString()}
          </p>
        </div>
        <Badge variant="secondary">{data.status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details (admin view — credentials revealed)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted overflow-auto rounded-md p-3 text-xs">
            {JSON.stringify(data.details, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Update status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <select
            className="bg-background block rounded-md border px-3 py-2 text-sm"
            value={nextStatus}
            onChange={(e) => setNextStatus(e.target.value as RequestStatus)}
          >
            <option value="">Select status…</option>
            {Object.values(RequestStatus).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button onClick={onUpdateStatus} disabled={!nextStatus || updateStatus.isPending}>
            {updateStatus.isPending ? 'Updating…' : 'Update'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload final report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canUpload ? (
            <p className="text-muted-foreground text-sm">
              {hasReport
                ? 'A report already exists for this request.'
                : 'Upload not allowed in this status.'}
            </p>
          ) : (
            <form onSubmit={onUpload} className="space-y-3">
              <div>
                <Label htmlFor="pdf-file">PDF (max 50MB)</Label>
                <input
                  ref={fileRef}
                  id="pdf-file"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm"
                  disabled={upload.isPending}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  The PDF will be encrypted server-side with an auto-generated password.
                  The client receives the password via email and in the portal.
                </p>
              </div>
              {upload.isPending && progress > 0 && (
                <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
              <Button type="submit" disabled={upload.isPending}>
                {upload.isPending ? `Uploading… ${progress}%` : 'Upload PDF'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {hasReport && data.reports[0] && (
        <Card>
          <CardHeader>
            <CardTitle>Report</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              Uploaded {new Date(data.reports[0].uploadedAt).toLocaleString()} · downloads:{' '}
              {data.reports[0].downloadCount}
            </p>
            <Button
              className="mt-3"
              onClick={() => router.push(`/admin/reports/${data.reports[0]!.id}`)}
            >
              Open report detail
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
