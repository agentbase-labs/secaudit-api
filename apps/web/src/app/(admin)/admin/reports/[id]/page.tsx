'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdminReport, useRegeneratePassword } from '@/lib/hooks/use-reports';

export default function AdminReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useAdminReport(id);
  const regen = useRegeneratePassword(id);
  const [showPassword, setShowPassword] = useState(false);
  const [reason, setReason] = useState('');

  async function onRegenerate() {
    try {
      const res = await regen.mutateAsync({ reason: reason || 'Resent by admin' });
      toast.success(
        res.reEncrypted
          ? 'Password regenerated and PDF re-encrypted. Client emailed.'
          : 'Password regenerated. Client emailed. (PDF NOT re-encrypted — original missing.)',
      );
      setReason('');
      void refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function copyPassword() {
    if (!data?.password) return;
    void navigator.clipboard.writeText(data.password);
    toast.success('Password copied');
  }

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const sizeMb = (Number(data.fileSize) / 1024 / 1024).toFixed(2);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Report</h1>
          <p className="text-muted-foreground text-sm">
            ID <code>{data.id}</code> · request <code>{data.requestId}</code>
          </p>
        </div>
        <Badge variant="secondary">{data.hasOriginal ? 'original kept' : 'no original'}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>File</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[160px_1fr] gap-y-1 text-sm">
            <dt className="text-muted-foreground">Encrypted size</dt>
            <dd>{sizeMb} MB</dd>
            <dt className="text-muted-foreground">Uploaded</dt>
            <dd>{new Date(data.uploadedAt).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Downloads</dt>
            <dd>{data.downloadCount}</dd>
            <dt className="text-muted-foreground">Last downloaded</dt>
            <dd>
              {data.lastDownloadedAt
                ? new Date(data.lastDownloadedAt).toLocaleString()
                : '—'}
            </dd>
            <dt className="text-muted-foreground">Encrypted R2 key</dt>
            <dd>
              <code className="text-xs">{data.encryptedPdfR2Key}</code>
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.password ? (
            <>
              <div className="flex items-center gap-2">
                <code className="bg-muted block w-full rounded-md px-3 py-2 font-mono text-sm">
                  {showPassword ? data.password : '••••••••••••••••'}
                </code>
                <Button variant="outline" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? 'Hide' : 'Show'}
                </Button>
                <Button variant="outline" onClick={copyPassword}>
                  Copy
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Issued{' '}
                {data.passwordCreatedAt
                  ? new Date(data.passwordCreatedAt).toLocaleString()
                  : 'unknown'}
                . Every reveal is audit-logged as <code>report.password.viewed</code>.
              </p>
            </>
          ) : (
            <p className="text-destructive text-sm">
              No password on file (legacy bcrypt-only report). Use Regenerate to issue a new one.
            </p>
          )}

          <div className="space-y-2 pt-3 border-t">
            <Label htmlFor="reason">Reason (sent in audit log + client email)</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client lost the original email"
              disabled={regen.isPending}
            />
            <Button onClick={onRegenerate} disabled={regen.isPending}>
              {regen.isPending ? 'Regenerating…' : 'Regenerate & resend password'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
        </CardHeader>
        <CardContent>
          {data.auditLog.length === 0 ? (
            <p className="text-muted-foreground text-sm">No entries yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.auditLog.map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex justify-between gap-4">
                    <code className="text-xs">{a.action}</code>
                    <span className="text-muted-foreground text-xs">
                      {new Date(a.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {Object.keys(a.meta).length > 0 && (
                    <pre className="bg-muted mt-1 overflow-auto rounded p-2 text-[11px]">
                      {JSON.stringify(a.meta, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
