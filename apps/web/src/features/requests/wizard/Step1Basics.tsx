'use client';

import { AssetType, TestingType } from '@cs-platform/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WizardState } from './types';

interface Step1Props {
  state: WizardState;
  set: (patch: Partial<WizardState>) => void;
  onNext: () => void;
}

export function Step1Basics({ state, set, onNext }: Step1Props) {
  const canProceed = Boolean(state.assetType && state.testingType && state.title.trim().length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>1. What do you want tested?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Asset type</Label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {Object.values(AssetType).map((at) => (
              <Button
                key={at}
                type="button"
                variant={state.assetType === at ? 'default' : 'outline'}
                onClick={() => set({ assetType: at })}
              >
                {at}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="testingType">Testing type</Label>
          <select
            id="testingType"
            className="bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            value={state.testingType ?? ''}
            onChange={(e) => set({ testingType: e.target.value as TestingType })}
          >
            <option value="" disabled>
              Select…
            </option>
            {Object.values(TestingType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="title">Short title</Label>
          <Input
            id="title"
            value={state.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Acme storefront — pre-launch pen test"
            maxLength={200}
          />
        </div>

        <div>
          <Label htmlFor="description">Brief description (optional)</Label>
          <textarea
            id="description"
            rows={3}
            className="bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            value={state.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="One or two sentences for our triage team."
            maxLength={2000}
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button type="button" onClick={onNext} disabled={!canProceed}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
