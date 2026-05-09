import type { AssetType, TestingType } from '@cs-platform/shared';

/** Wizard step ids. Add to this if the flow grows. */
export type WizardStepId = 1 | 2 | 3;

export const WIZARD_STEPS: { id: WizardStepId; label: string; short: string }[] = [
  { id: 1, label: 'Type & basics', short: 'Basics' },
  { id: 2, label: 'Target details', short: 'Target' },
  { id: 3, label: 'Review & submit', short: 'Review' },
];

/**
 * The whole wizard state. Lives in `useReducer` and is autosaved to
 * `localStorage` under `cs-platform:request-draft:v1`.
 */
export interface WizardState {
  currentStep: WizardStepId;
  /** Highest step the user has reached \u2014 controls the click-to-jump rules. */
  furthestStep: WizardStepId;
  assetType: AssetType | null;
  testingType: TestingType | null;
  title: string;
  description: string;
  /** Per-asset-type details (free-form bag; validated at submit time). */
  details: Record<string, unknown>;
}

export const INITIAL_STATE: WizardState = {
  currentStep: 1,
  furthestStep: 1,
  assetType: null,
  testingType: null,
  title: '',
  description: '',
  details: { env: 'prod' },
};

export type WizardAction =
  | { type: 'set'; patch: Partial<WizardState> }
  | { type: 'set-details'; patch: Record<string, unknown> }
  | { type: 'goto'; step: WizardStepId }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'reset' }
  | { type: 'restore'; state: WizardState };
