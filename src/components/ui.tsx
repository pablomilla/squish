import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { matchStatusBar } from '../lib/native';
import { DEFAULT_LOOK, lookById, lookVars } from '../lib/looks';
import { CloseIcon } from './icons';
import { t } from '../lib/i18n';

/* ---------------- Bottom sheet ---------------- */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider on a desk-sized screen; the same as any other sheet on a phone. */
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'sheet sheet--wide' : 'sheet'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grip" />
        {title && (
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2>{title}</h2>
            <button type="button" className="btn--quiet" onClick={onClose} aria-label={t('Close')}>
              <CloseIcon />
            </button>
          </div>
        )}
        {children}
        {footer && <div style={{ marginTop: 16 }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Toasts ---------------- */
interface Toast {
  id: number;
  message: string;
  emoji?: string;
}

const ToastContext = createContext<(message: string, emoji?: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, emoji?: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, message, emoji }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="toast-layer" aria-live="polite">
          {toasts.map((toast) => (
            <div className="toast" key={toast.id}>
              {toast.emoji && <span aria-hidden="true">{toast.emoji}</span>}
              <span>{toast.message}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ---------------- Segmented control ---------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Stepper ---------------- */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 99,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v * 100) / 100));
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(clamp(value - step))} aria-label={t('Decrease')}>−</button>
      <span>
        {value.toLocaleString()}
        {suffix ? ` ${suffix}` : ''}
      </span>
      <button type="button" onClick={() => onChange(clamp(value + step))} aria-label={t('Increase')}>+</button>
    </div>
  );
}

/* ---------------- Theme ---------------- */

/**
 * What the browser is currently asking for, live.
 *
 * Worth exposing on its own: when someone picks Auto and gets dark all day,
 * the question is always whether the app is broken or the phone is set that
 * way — and on Android it is usually the phone, since Chrome has a dark theme
 * setting of its own that is separate from the system one.
 */
export function usePrefersDark(): boolean {
  const media = useMemo(
    () => (typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null),
    [],
  );
  const [dark, setDark] = useState(media?.matches ?? false);

  useEffect(() => {
    if (!media) return;
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [media]);

  return dark;
}

/**
 * Dress every Squish on the page at once.
 *
 * Set on the document rather than passed to each mascot, because they are not
 * all reachable: the share card rasterises whatever is on screen, and a prop
 * threaded through six screens is a prop somebody forgets on the seventh.
 * Removed rather than set for the default look, so the stylesheet keeps
 * owning it and there is one place the original colours live.
 */
export function useAppliedLook(look: string, dark: boolean) {
  useEffect(() => {
    const { style } = document.documentElement;
    const chosen = lookById(look);
    const vars = lookVars(chosen, dark);

    if (chosen.id === DEFAULT_LOOK) {
      for (const name of Object.keys(vars)) style.removeProperty(name);
      return;
    }
    for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
  }, [look, dark]);
}

export function useAppliedTheme(preference: 'light' | 'dark' | 'system') {
  const systemDark = usePrefersDark();
  const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#17151f' : '#FDF6EC');
    // The phone's own status bar sits over the app, so it has to be told too
    // — the meta tag it ignores. A no-op in a browser.
    void matchStatusBar(theme === 'dark');
  }, [theme]);

  return theme;
}
