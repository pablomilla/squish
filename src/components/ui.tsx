import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';

/* ---------------- Bottom sheet ---------------- */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
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
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grip" />
        {title && (
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2>{title}</h2>
            <button type="button" className="btn--quiet" onClick={onClose} aria-label="Close">
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
      <button type="button" onClick={() => onChange(clamp(value - step))} aria-label="Decrease">−</button>
      <span>
        {value}
        {suffix ? ` ${suffix}` : ''}
      </span>
      <button type="button" onClick={() => onChange(clamp(value + step))} aria-label="Increase">+</button>
    </div>
  );
}

/* ---------------- Theme ---------------- */
export function useAppliedTheme(preference: 'light' | 'dark' | 'system') {
  const media = useMemo(
    () => (typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null),
    [],
  );
  const [systemDark, setSystemDark] = useState(media?.matches ?? false);

  useEffect(() => {
    if (!media) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [media]);

  const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#17151f' : '#FDF6EC');
  }, [theme]);

  return theme;
}
