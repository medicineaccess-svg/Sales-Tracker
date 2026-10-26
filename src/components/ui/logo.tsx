import { useState } from 'react';
import { BRAND_LOGO_URL } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/** Ikris Pharma Network logo with a typographic fallback if the image cannot load. */
export function Logo({ className, variant = 'dark' }: { className?: string; variant?: 'dark' | 'light' }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">IK</span>
        <span className={variant === 'light' ? 'text-white' : 'text-navy'}>Ikris Pharma Network</span>
      </span>
    );
  }
  return (
    <img
      src={BRAND_LOGO_URL}
      alt="Ikris Pharma Network"
      className={cn('h-9 w-auto object-contain', variant === 'light' && 'rounded-md bg-white px-2 py-1', className)}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
    />
  );
}
