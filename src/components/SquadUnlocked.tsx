import { stickerUrl, unlockUrl } from './shareArt';
import { rich } from '../lib/i18n-react';

const lessMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * The moment the squad set arrives: the badge, with its confetti burst played
 * once — the designer's one-second animation, which never loops. Somebody who
 * has asked for less motion gets the still badge. Shown only when the server
 * says a friend has newly got going, not every time the card is drawn.
 */
export default function SquadUnlocked({ compact = false }: { compact?: boolean }) {
  const src = (lessMotion() ? undefined : unlockUrl('squad-badge')) ?? stickerUrl('squad-badge');
  return (
    <div className={`squad-unlocked${compact ? ' squad-unlocked--compact' : ''}`} role="status">
      <img src={src} alt="" width={compact ? 56 : 76} height={compact ? 56 : 76} />
      <p className="small">
        {rich('<b>Squad set unlocked.</b> A cap for Squish, and a frame and badge for your cards — only ever earned by inviting.', {}, { b: (text) => <b>{text}</b> })}
      </p>
    </div>
  );
}
