import type { ReactNode } from 'react';
import type { ShelfKind } from '../lib/outfit';
import './shelf.css';
import { t } from '../lib/i18n';

/** One group in a picker, headed by how everything in it is got. */
export function Shelf({ title, kind, subscribed, children }: { title: string; kind: ShelfKind; subscribed: boolean; children: ReactNode }) {
  const soon = kind === 'pack' || (kind === 'plus' && !subscribed);
  return (
    <div className="shelf">
      <div className="shelf-head">
        <p className="tiny shelf-title">{title}</p>
        {soon && <span className="badge">{t('Not on sale yet')}</span>}
      </div>
      {children}
    </div>
  );
}

export default Shelf;
