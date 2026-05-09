import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminHome() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/admin/requests">
          <Card className="hover:border-primary/50 transition">
            <CardHeader>
              <CardTitle>Requests</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              Review client submissions, update status, upload reports.
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/users">
          <Card className="hover:border-primary/50 transition">
            <CardHeader>
              <CardTitle>Users</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              Manage roles and disable accounts.
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/health">
          <Card className="hover:border-primary/50 transition">
            <CardHeader>
              <CardTitle>Health</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              DB, R2, mail, queue.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
