import { useState, type ReactNode } from 'react';
import { useSquish } from '../store/useSquish';
import { t } from '../lib/i18n';

/*
 * Just the essentials, or everything (profile.detail).
 *
 * Essentials is the same app with the detail tucked away, never taken away:
 * every screen marks what is detail, and in essentials each of those is one
 * "More detail" tap from where it was. One app, not two to keep in step.
 */

/** Whether they asked for just the essentials. */
export function useEssentials(): boolean {
  return useSquish((s) => s.profile.detail === 'essentials');
}

/**
 * For a part of a screen with some detail in it: whether to show it all now,
 * and the button that shows it (none at all for somebody who sees everything).
 */
export function useMoreDetail(): { full: boolean; toggle: ReactNode } {
  const essentials = useEssentials();
  const [open, setOpen] = useState(false);
  if (!essentials) return { full: true, toggle: null };
  return {
    full: open,
    toggle: (
      <button type="button" className="more-link tiny detail-toggle" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        {open ? t('Less detail') : t('More detail ›')}
      </button>
    ),
  };
}
