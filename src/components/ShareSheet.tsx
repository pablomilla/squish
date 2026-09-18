import { useEffect, useRef, useState } from 'react';
import Squish from './Squish';
import { Sheet, useToast } from './ui';
import { renderShareCard, shareCard, type ShareCardData } from '../lib/share';
import './sharesheet.css';

/**
 * Shows the card before it goes anywhere.
 *
 * The mascot is rendered here, off to the side, purely so the card has real
 * artwork to rasterise — drawing it a second time on canvas would be a copy of
 * the mascot to keep in step for ever.
 */
export function ShareSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: ShareCardData }) {
  const toast = useToast();
  const mascotRef = useRef<SVGSVGElement>(null);
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);
  const [failed, setFailed] = useState(false);

  // The card is redrawn when its contents change, not when the parent screen
  // happens to re-render — the caller passes a fresh object literal each time.
  const signature = JSON.stringify(data);

  useEffect(() => {
    // The sheet's children are committed before this runs, so the hidden
    // mascot is already in the DOM and ready to be cloned.
    const mascot = mascotRef.current;
    if (!open || !mascot) return;

    let live = true;
    let url: string | null = null;

    renderShareCard(data, mascot)
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setCard({ blob, url });
      })
      .catch(() => live && setFailed(true));

    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
      setCard(null);
      setFailed(false);
    };
  }, [open, signature]);

  const send = async () => {
    if (!card) return;
    const outcome = await shareCard(card.blob, `${data.headline} — tracked with Squish`);
    if (outcome === 'downloaded') toast('Saved to your downloads', '📥');
    if (outcome === 'shared') onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Share your progress">
      <div className="share-body">
        {/* Off-canvas source artwork for the card, not decoration. */}
        <Squish ref={mascotRef} mood={data.mood} size={200} bob={false} className="share-source" />

        {card ? (
          <img className="share-preview" src={card.url} alt={`${data.headline}. ${data.subline}`} />
        ) : failed ? (
          <p className="empty">The card would not draw on this browser. Everything else still works.</p>
        ) : (
          <div className="skeleton share-preview" />
        )}

        <button type="button" className="btn btn--block" disabled={!card} onClick={() => void send()}>
          Share
        </button>
        <p className="tiny muted center">Made on your phone. Nothing is uploaded.</p>
      </div>
    </Sheet>
  );
}

export default ShareSheet;
