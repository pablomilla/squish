import { useEffect, useRef } from 'react';
import type { Route } from '../types';
import { Sheet } from './ui';
import { BarcodeIcon, CameraIcon, HeartIcon, LinkIcon, PenIcon, SearchIcon } from './icons';
import './add-sheet.css';

/**
 * Every way into the diary, in one place.
 *
 * The middle button used to go straight to the camera, which was right about
 * what people mostly do and wrong about everything else: describing a meal,
 * searching, a saved favourite and a barcode were all buried behind screens
 * you had to already know about. Most of this app's best parts were invisible
 * from the one control everybody presses.
 *
 * It costs a tap on the commonest action, which is a real cost. Snapping is
 * first and given its own weight to keep that tap cheap and obvious.
 */
const WAYS: { label: string; hint: string; Icon: typeof CameraIcon; route: Route; primary?: boolean }[] = [
  { label: 'Snap a meal', hint: 'Point the camera at your plate', Icon: CameraIcon, route: { name: 'capture' }, primary: true },
  { label: 'Describe it', hint: 'In your own words, or out loud', Icon: PenIcon, route: { name: 'add', tab: 'describe' } },
  { label: 'Search foods', hint: 'Everyday foods and portions', Icon: SearchIcon, route: { name: 'add', tab: 'search' } },
  { label: 'Saved', hint: 'The meals you eat every week', Icon: HeartIcon, route: { name: 'add', tab: 'favourites' } },
  { label: 'Scan a barcode', hint: 'Straight off the packet', Icon: BarcodeIcon, route: { name: 'capture', shot: 'barcode' } },
  { label: 'Recipe from a link', hint: 'A page you cooked from', Icon: LinkIcon, route: { name: 'add', tab: 'recipe' } },
];

export default function AddSheet({ open, onClose, go }: { open: boolean; onClose: () => void; go: (route: Route) => void }) {
  const firstRef = useRef<HTMLButtonElement>(null);

  // Land in the sheet rather than behind it. Without this a keyboard or a
  // screen reader stays on the button that opened it.
  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Add food">
      <div className="add-ways">
        {WAYS.map(({ label, hint, Icon, route, primary }, i) => (
          <button
            key={label}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            className={`add-way${primary ? ' add-way--primary' : ''}`}
            onClick={() => {
              onClose();
              go(route);
            }}
          >
            <span className="add-way-icon"><Icon size={primary ? 24 : 20} /></span>
            <span className="add-way-text">
              <b>{label}</b>
              <span className="tiny muted">{hint}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
