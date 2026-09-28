import './menu-list.css';

/** One row of a menu (a `.menu-list` nav): an icon, what it is, where it stands, and a way in. */
export function MenuRow({ icon, label, value, note, onClick }: { icon: string; label: string; value: string; note?: string; onClick: () => void }) {
  return (
    <button type="button" className="menu-row" onClick={onClick}>
      <span className="menu-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="menu-row-label">{label}</span>
      {note && <span className="badge badge--warn">{note}</span>}
      <span className="menu-row-value">{value}</span>
      <span className="menu-row-more" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
