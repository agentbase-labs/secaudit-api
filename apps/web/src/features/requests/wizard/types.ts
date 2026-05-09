import { AssetType, type TestingType } from '@cs-platform/shared';

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

/**
 * Returns the empty/default `details` shape for a given assetType. Used to
 * reset `details` whenever the user switches asset types in the wizard
 * (otherwise stale fields from the previous type leak into the submission
 * payload). Mirrors the per-type Zod schemas in `@cs-platform/shared`.
 */
export function getEmptyDetailsForAssetType(
  assetType: AssetType | null,
): Record<string, unknown> {
  switch (assetType) {
    case AssetType.WEBSITE:
      return { url: '', env: 'prod' };
    case AssetType.MOBILE_APP:
      return { platform: 'android', appName: '', packageName: '', env: 'prod' };
    case AssetType.ATTACK_SURFACE:
      return { domain: '' };
    case AssetType.EXTERNAL_INFRA:
      return { ips: [] as string[] };
    case null:
    default:
      return { env: 'prod' };
  }
}

/**
 * Strip any `details` keys that don't belong to the current `assetType`.
 * Used (a) when restoring a draft from localStorage that may carry stale
 * fields from a previous asset type, and (b) on the Review step so the
 * user only sees fields relevant to the chosen type. Defensive — the wizard
 * also resets `details` on assetType change.
 */
export function sanitizeDetailsForAssetType(
  assetType: AssetType | null,
  details: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const empty = getEmptyDetailsForAssetType(assetType);
  const allowedKeys = new Set(Object.keys(empty));
  // Per-type, allow a few optional fields that are valid in the schema but
  // not part of the empty shape (login for website, storeLink/notes etc).
  if (assetType === AssetType.WEBSITE) {
    allowedKeys.add('login');
    allowedKeys.add('notes');
  } else if (assetType === AssetType.MOBILE_APP) {
    allowedKeys.add('storeLink');
    allowedKeys.add('mobileFileKey');
    allowedKeys.add('notes');
  } else if (assetType === AssetType.ATTACK_SURFACE) {
    allowedKeys.add('notes');
  } else if (assetType === AssetType.EXTERNAL_INFRA) {
    allowedKeys.add('notes');
  }
  const src = (details ?? {}) as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (allowedKeys.has(key)) cleaned[key] = src[key];
  }
  // Fill defaults for any required key that isn't present, so the form
  // controls don't render `undefined`.
  for (const [k, v] of Object.entries(empty)) {
    if (!(k in cleaned)) cleaned[k] = v;
  }
  return cleaned;
}

export type WizardAction =
  | { type: 'set'; patch: Partial<WizardState> }
  | { type: 'set-details'; patch: Record<string, unknown> }
  | { type: 'goto'; step: WizardStepId }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'reset' }
  | { type: 'restore'; state: WizardState };
