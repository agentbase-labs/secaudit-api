'use client';

import { WIZARD_STEPS, type WizardStepId } from './types';

interface StepperProps {
  current: WizardStepId;
  furthest: WizardStepId;
  onJump: (step: WizardStepId) => void;
}

/**
 * Top-of-page stepper. Click-to-jump is allowed only to steps the user has
 * already reached (`furthest`); future steps stay disabled until validation
 * pushes them forward.
 */
export function Stepper({ current, furthest, onJump }: StepperProps) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {WIZARD_STEPS.map((s, idx) => {
        const isCurrent = s.id === current;
        const isReached = s.id <= furthest;
        const isComplete = s.id < furthest;
        const clickable = isReached && !isCurrent;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump(s.id)}
              className={[
                'flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors',
                isCurrent
                  ? 'bg-primary text-primary-foreground'
                  : isComplete
                    ? 'bg-muted text-foreground hover:bg-muted/80'
                    : isReached
                      ? 'bg-muted text-foreground'
                      : 'bg-muted/40 text-muted-foreground cursor-not-allowed',
                clickable ? 'cursor-pointer' : '',
              ].join(' ')}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span
                className={[
                  'flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold',
                  isCurrent
                    ? 'bg-primary-foreground text-primary'
                    : isComplete
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background',
                ].join(' ')}
              >
                {isComplete ? '✓' : s.id}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{s.short}</span>
            </button>
            {idx < WIZARD_STEPS.length - 1 && (
              <span aria-hidden className="text-muted-foreground">
                ›
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
