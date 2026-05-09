'use client';

import { useMemo } from 'react';
import { AssetType, detailsSchemaForAssetType } from '@cs-platform/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WizardState } from './types';

interface Step2Props {
  state: WizardState;
  setDetails: (patch: Record<string, unknown>) => void;
  onBack: () => void;
  onNext: () => void;
}

/** Per-asset-type form, validated against the shared zod schema. */
export function Step2Target({ state, setDetails, onBack, onNext }: Step2Props) {
  const validation = useMemo(() => {
    if (!state.assetType) return { ok: false, issues: [] as string[] };
    const schema = detailsSchemaForAssetType(state.assetType);
    const result = schema.safeParse(state.details);
    if (result.success) return { ok: true, issues: [] };
    return {
      ok: false,
      issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }, [state.assetType, state.details]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>2. Target details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.assetType === AssetType.WEBSITE && <WebsiteFields state={state} setDetails={setDetails} />}
        {state.assetType === AssetType.MOBILE_APP && (
          <MobileAppFields state={state} setDetails={setDetails} />
        )}
        {state.assetType === AssetType.ATTACK_SURFACE && (
          <AttackSurfaceFields state={state} setDetails={setDetails} />
        )}
        {state.assetType === AssetType.EXTERNAL_INFRA && (
          <ExternalInfraFields state={state} setDetails={setDetails} />
        )}

        <div>
          <Label htmlFor="notes">Notes (optional)</Label>
          <textarea
            id="notes"
            rows={3}
            className="bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            value={(state.details.notes as string) ?? ''}
            onChange={(e) => setDetails({ notes: e.target.value })}
            maxLength={5000}
          />
        </div>

        {!validation.ok && validation.issues.length > 0 && (
          <ul className="text-destructive text-xs space-y-0.5">
            {validation.issues.map((m) => (
              <li key={m}>• {m}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="button" onClick={onNext} disabled={!validation.ok}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- per-type field groups ---

function FieldText({
  label,
  name,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function EnvSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label htmlFor="env">Environment</Label>
      <select
        id="env"
        className="bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="prod">prod</option>
        <option value="test">test</option>
      </select>
    </div>
  );
}

function WebsiteFields({
  state,
  setDetails,
}: {
  state: WizardState;
  setDetails: (patch: Record<string, unknown>) => void;
}) {
  const login = (state.details.login as Record<string, string> | undefined) ?? null;
  return (
    <>
      <FieldText
        label="URL"
        name="url"
        value={(state.details.url as string) ?? ''}
        onChange={(v) => setDetails({ url: v })}
        placeholder="https://app.example.com"
      />
      <EnvSelect
        value={(state.details.env as string) ?? 'prod'}
        onChange={(v) => setDetails({ env: v })}
      />
      <div className="rounded-md border p-3 space-y-2">
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(login)}
            onChange={(e) =>
              setDetails({
                login: e.target.checked
                  ? { username: '', password: '' }
                  : undefined,
              })
            }
          />
          <span>Provide login credentials</span>
        </Label>
        {login && (
          <div className="space-y-2 pt-1">
            <FieldText
              label="Username"
              name="login.username"
              value={login.username ?? ''}
              onChange={(v) => setDetails({ login: { ...login, username: v } })}
            />
            <FieldText
              label="Password"
              name="login.password"
              type="password"
              value={login.password ?? ''}
              onChange={(v) => setDetails({ login: { ...login, password: v } })}
            />
          </div>
        )}
      </div>
    </>
  );
}

function MobileAppFields({
  state,
  setDetails,
}: {
  state: WizardState;
  setDetails: (patch: Record<string, unknown>) => void;
}) {
  return (
    <>
      <FieldText
        label="App name"
        name="appName"
        value={(state.details.appName as string) ?? ''}
        onChange={(v) => setDetails({ appName: v })}
      />
      <FieldText
        label="Package name"
        name="packageName"
        value={(state.details.packageName as string) ?? ''}
        onChange={(v) => setDetails({ packageName: v })}
        placeholder="com.acme.app"
      />
      <div>
        <Label htmlFor="platform">Platform</Label>
        <select
          id="platform"
          className="bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          value={(state.details.platform as string) ?? ''}
          onChange={(e) => setDetails({ platform: e.target.value })}
        >
          <option value="" disabled>
            Select…
          </option>
          <option value="android">Android</option>
          <option value="ios">iOS</option>
        </select>
      </div>
      <FieldText
        label="Store link (optional)"
        name="storeLink"
        value={(state.details.storeLink as string) ?? ''}
        onChange={(v) => setDetails({ storeLink: v })}
        placeholder="https://play.google.com/..."
      />
      <EnvSelect
        value={(state.details.env as string) ?? 'prod'}
        onChange={(v) => setDetails({ env: v })}
      />
      <p className="text-muted-foreground text-xs">
        APK / IPA upload: available on the request detail page after submission, via a
        presigned R2 URL.
      </p>
    </>
  );
}

function AttackSurfaceFields({
  state,
  setDetails,
}: {
  state: WizardState;
  setDetails: (patch: Record<string, unknown>) => void;
}) {
  return (
    <FieldText
      label="Company domain"
      name="domain"
      value={(state.details.domain as string) ?? ''}
      onChange={(v) => setDetails({ domain: v })}
      placeholder="acme.com"
    />
  );
}

function ExternalInfraFields({
  state,
  setDetails,
}: {
  state: WizardState;
  setDetails: (patch: Record<string, unknown>) => void;
}) {
  const ips = Array.isArray(state.details.ips) ? (state.details.ips as string[]) : [];
  return (
    <FieldText
      label="IPs / CIDRs (comma-separated)"
      name="ips"
      value={ips.join(', ')}
      onChange={(v) =>
        setDetails({
          ips: v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        })
      }
      placeholder="203.0.113.10, 198.51.100.0/24"
    />
  );
}
