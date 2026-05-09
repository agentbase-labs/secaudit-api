'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sanitizeDetailsForAssetType, type WizardState } from './types';

interface Step3Props {
  state: WizardState;
  isSubmitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

export function Step3Review({ state, isSubmitting, onBack, onSubmit }: Step3Props) {
  // Only show fields that belong to the current assetType. Defensive against
  // any path where stale fields from a previous type could survive in state.
  const displayDetails = useMemo(
    () => sanitizeDetailsForAssetType(state.assetType, state.details),
    [state.assetType, state.details],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>3. Review &amp; submit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Asset type</dt>
          <dd>{state.assetType ?? '—'}</dd>
          <dt className="text-muted-foreground">Testing type</dt>
          <dd>{state.testingType ?? '—'}</dd>
          <dt className="text-muted-foreground">Title</dt>
          <dd>{state.title || '—'}</dd>
          {state.description && (
            <>
              <dt className="text-muted-foreground">Description</dt>
              <dd className="whitespace-pre-wrap">{state.description}</dd>
            </>
          )}
        </dl>
        <div>
          <p className="text-muted-foreground mb-1 text-xs uppercase tracking-wide">
            Target details
          </p>
          <pre className="bg-muted overflow-auto rounded-md p-3 text-xs">
            {JSON.stringify(displayDetails, null, 2)}
          </pre>
        </div>
        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
            Back
          </Button>
          <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
