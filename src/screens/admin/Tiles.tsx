/** The dashboard's headline numbers: one figure, what it is, and which way it is going. */
import type { ReactNode } from 'react';
import { Sparkline } from './charts';
import { delta } from './format';

export function Tile({
  label,
  value,
  note,
  now,
  before,
  days,
  spark,
  onClick,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** With `before`, shown as the change on the period before. */
  now?: number;
  before?: number;
  days?: number;
  spark?: number[];
  onClick?: () => void;
}) {
  const change = now !== undefined && before !== undefined ? delta(now, before) : null;
  const body = (
    <>
      <span className="tile-label">{label}</span>
      <b className="tile-value">{value}</b>
      {change ? (
        <span className="tile-note">
          {change.arrow && <span aria-hidden="true">{change.arrow} </span>}
          {change.text}
          {change.text !== 'no change' && change.text !== 'new' && (change.arrow === '▲' ? ' up' : ' down')} on the {days} days
          before
        </span>
      ) : (
        note && <span className="tile-note">{note}</span>
      )}
      {spark && <Sparkline values={spark} />}
    </>
  );
  return onClick ? (
    <button type="button" className="tile tile--link" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="tile">{body}</div>
  );
}

export type AlertTone = 'warn' | 'info' | 'bad';

const ICON: Record<AlertTone, string> = { warn: '⚠️', info: 'ℹ️', bad: '⛔' };

/** Something that wants doing. Always an icon and words, never colour alone. */
export function Alert({ tone, title, children, action }: { tone: AlertTone; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'info' ? undefined : 'alert'}>
      <span className="alert-icon" aria-hidden="true">
        {ICON[tone]}
      </span>
      <div className="alert-text">
        <b className="small">{title}</b>
        {children && <p className="tiny">{children}</p>}
      </div>
      {action}
    </div>
  );
}
