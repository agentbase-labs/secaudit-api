'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CreateRequestSchema } from '@cs-platform/shared';
import { Button } from '@/components/ui/button';
import { useCreateRequest } from '@/lib/hooks/use-requests';
import { Step1Basics } from '@/features/requests/wizard/Step1Basics';
import { Step2Target } from '@/features/requests/wizard/Step2Target';
import { Step3Review } from '@/features/requests/wizard/Step3Review';
import { Stepper } from '@/features/requests/wizard/Stepper';
import { useRequestDraft } from '@/features/requests/wizard/useRequestDraft';
import { useWizardState } from '@/features/requests/wizard/useWizardState';

/**
 * Multi-step request wizard.
 *
 *   - Single route, internal stepper state (no route changes).
 *   - Click-to-jump only to previously reached steps.
 *   - Draft autosaved to localStorage; restored on mount with a banner.
 *   - Final submit hits POST /requests; draft is cleared on success.
 */
export default function NewRequestPage() {
  const router = useRouter();
  const create = useCreateRequest();
  const { state, set, setDetails, goto, next, back, restore } = useWizardState();
  const draft = useRequestDraft(state, restore);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!state.assetType || !state.testingType) {
      toast.error('Pick an asset type and testing type first.');
      goto(1);
      return;
    }
    // Final validation against the discriminated union before we hit the API.
    const payload = {
      assetType: state.assetType,
      testingType: state.testingType,
      details: state.details,
    };
    const parsed = CreateRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = first
        ? `${first.path.join('.') || '(root)'}: ${first.message}`
        : 'Invalid request payload';
      setSubmitError(msg);
      toast.error(msg);
      goto(2);
      return;
    }
    setSubmitError(null);
    try {
      const res = await create.mutateAsync(parsed.data);
      draft.clear();
      toast.success('Request submitted');
      router.push(`/dashboard/requests/${res.id}`);
    } catch (e) {
      const msg = (e as Error).message;
      setSubmitError(msg);
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">New testing request</h1>
        <Stepper current={state.currentStep} furthest={state.furthestStep} onJump={goto} />
      </div>

      {draft.bannerVisible && draft.restoredAt && (
        <div className="bg-muted text-foreground flex items-center justify-between rounded-md border p-3 text-sm">
          <span>
            We restored a draft from {draft.restoredAt.toLocaleString()}.
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={draft.dismissBanner}>
              Keep
            </Button>
            <Button variant="outline" size="sm" onClick={draft.clear}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {state.currentStep === 1 && <Step1Basics state={state} set={set} onNext={next} />}
      {state.currentStep === 2 && (
        <Step2Target state={state} setDetails={setDetails} onBack={back} onNext={next} />
      )}
      {state.currentStep === 3 && (
        <Step3Review
          state={state}
          isSubmitting={create.isPending}
          onBack={back}
          onSubmit={handleSubmit}
        />
      )}

      {submitError && (
        <p className="text-destructive text-sm">{submitError}</p>
      )}
    </div>
  );
}
