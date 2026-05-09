'use client';

import { useEffect, useRef, useState } from 'react';
import { sanitizeDetailsForAssetType, type WizardState } from './types';

const DRAFT_KEY = 'cs-platform:request-draft:v1';

/**
 * Autosave the wizard state to `localStorage`. Returns whether a draft was
 * restored on mount so the page can show the "we restored a draft" banner.
 *
 * SSR-safe: localStorage access is gated by `typeof window !== 'undefined'`.
 */
export function useRequestDraft(
  state: WizardState,
  onRestore: (s: WizardState) => void,
): { restoredAt: Date | null; clear: () => void; dismissBanner: () => void; bannerVisible: boolean } {
  const [restoredAt, setRestoredAt] = useState<Date | null>(null);
  const [bannerVisible, setBannerVisible] = useState(false);
  // Avoid re-running the restore on every render.
  const didRestore = useRef(false);

  // Restore on mount.
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { savedAt: string; state: WizardState } | null;
      if (parsed?.state && parsed.state.assetType !== undefined) {
        // Defensive: drafts saved before the assetType-reset fix may carry
        // fields that don't belong to the saved assetType. Strip them so the
        // Review step / submit payload don't leak stale data.
        const sanitized: WizardState = {
          ...parsed.state,
          details: sanitizeDetailsForAssetType(
            parsed.state.assetType,
            parsed.state.details,
          ),
        };
        onRestore(sanitized);
        setRestoredAt(new Date(parsed.savedAt));
        setBannerVisible(true);
      }
    } catch {
      // Bad JSON — drop it silently.
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, [onRestore]);

  // Persist on every state change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Skip the very first save before restore had a chance to run.
    if (!didRestore.current) return;
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ savedAt: new Date().toISOString(), state }),
      );
    } catch {
      // Quota exceeded etc. — non-fatal.
    }
  }, [state]);

  function clear() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(DRAFT_KEY);
    setRestoredAt(null);
    setBannerVisible(false);
  }

  function dismissBanner() {
    setBannerVisible(false);
  }

  return { restoredAt, clear, dismissBanner, bannerVisible };
}
