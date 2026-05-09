import * as React from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export function Badge({
  variant = 'default',
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: BadgeVariant }) {
  const v =
    variant === 'default'
      ? 'bg-primary text-primary-foreground'
      : variant === 'secondary'
        ? 'bg-muted text-foreground'
        : variant === 'destructive'
          ? 'bg-destructive text-destructive-foreground'
          : 'border border-input';
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        v,
        className,
      )}
      {...props}
    />
  );
}
