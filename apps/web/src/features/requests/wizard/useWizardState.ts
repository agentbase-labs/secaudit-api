'use client';

import { useReducer, useCallback } from 'react';
import {
  INITIAL_STATE,
  getEmptyDetailsForAssetType,
  type WizardAction,
  type WizardState,
  type WizardStepId,
} from './types';

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'set': {
      // When assetType changes, reset `details` to the empty shape for the new
      // type so we never leak fields from the previous asset type into the
      // submission payload (e.g. mobile fields surviving a switch to website).
      const next = { ...state, ...action.patch };
      if (
        'assetType' in action.patch &&
        action.patch.assetType !== state.assetType
      ) {
        next.details = getEmptyDetailsForAssetType(action.patch.assetType ?? null);
      }
      return next;
    }
    case 'set-details':
      return { ...state, details: { ...state.details, ...action.patch } };
    case 'goto': {
      // Forward jumps gated by furthestStep; backwards always allowed.
      if (action.step > state.furthestStep) return state;
      return { ...state, currentStep: action.step };
    }
    case 'next': {
      if (state.currentStep >= 3) return state;
      const next = (state.currentStep + 1) as WizardStepId;
      return {
        ...state,
        currentStep: next,
        furthestStep: (Math.max(state.furthestStep, next) as WizardStepId),
      };
    }
    case 'back':
      if (state.currentStep <= 1) return state;
      return { ...state, currentStep: (state.currentStep - 1) as WizardStepId };
    case 'reset':
      return INITIAL_STATE;
    case 'restore':
      return action.state;
    default: {
      const _exhaustive: never = action;
      return state;
    }
  }
}

export function useWizardState(initial: WizardState = INITIAL_STATE) {
  const [state, dispatch] = useReducer(reducer, initial);

  const set = useCallback((patch: Partial<WizardState>) => dispatch({ type: 'set', patch }), []);
  const setDetails = useCallback(
    (patch: Record<string, unknown>) => dispatch({ type: 'set-details', patch }),
    [],
  );
  const goto = useCallback((step: WizardStepId) => dispatch({ type: 'goto', step }), []);
  const next = useCallback(() => dispatch({ type: 'next' }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const restore = useCallback((s: WizardState) => dispatch({ type: 'restore', state: s }), []);

  return { state, set, setDetails, goto, next, back, reset, restore };
}
