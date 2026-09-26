import { useEffect, useRef, useState } from 'react';
import Squish from './Squish';
import { Sheet, useToast } from './ui';
import { renderShareCard, shareCard, type ShareCardData } from '../lib/share';
import { FRAMES, STICKERS, decorOnShow, toggleSticker, usableDecor, type Decoration } from '../lib/shareDecor';
import { lockedNote, shelves, whyLocked, type ShelfKind } from '../lib/outfit';
import Shelf from './Shelf';
import { PLUS } from '../lib/plan';
import { useSquish } from '../store/useSquish';
import { useStanding, useSubscribed } from './useSubscribed';
import { friendsThisVisit, inviteText, periodWords, type Friends } from '../lib/friends';
import { frameMarkup, frameUrl, stickerMarkup, stickerUrl } from './shareArt';
import './sharesheet.css';
import { t } from '../lib/i18n';

/**
 * Shows the card before it goes anywhere, and lets it be dressed up: a frame
 * round the edge and up to two stickers beside Squish.
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

  const chosen = useSquish((s) => s.shareDecor);
  const setShareDecor = useSquish((s) => s.setShareDecor);
  const unlocked = useSquish((s) => s.unlocked);
  const unlock = useSquish((s) => s.unlock);
  const subscribed = useSubscribed();
  const today = new Date();
  const entitlement = { unlocked, subscribed, today };
  const decor = usableDecor(chosen, entitlement);
  const decorKey = `${decor.frame}|${decor.stickers.join(',')}`;

  // `data` is the dependency, so the caller must hand over a stable object —
  // a fresh literal on every parent render would redraw the card each time.
  useEffect(() => {
    // The sheet's children are committed before this runs, so the hidden
    // mascot is already in the DOM and ready to be cloned.
    const mascot = mascotRef.current;
    if (!open || !mascot) return;

    let live = true;
    let url: string | null = null;
    const [frameId, stickerList] = decorKey.split('|');

    Promise.all([frameId ? frameMarkup(frameId) : undefined, Promise.all(stickerList.split(',').filter(Boolean).map(stickerMarkup))])
      .then(([frame, stickers]) =>
        renderShareCard(data, mascot, { frame, stickers: stickers.filter((s): s is string => Boolean(s)) }),
      )
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
  }, [open, data, decorKey]);

  // Signed in, the card carries an invite: a friend who joins by it gets
  // Plus, and so does whoever shared it.
  const standing = useStanding();
  const [friends, setFriends] = useState<Friends | null>(null);
  useEffect(() => {
    if (!open || !standing.account) return;
    let live = true;
    void friendsThisVisit().then((found) => live && setFriends(found));
    return () => {
      live = false;
    };
  }, [open, standing.account]);

  const send = async () => {
    if (!card) return;
    const words = t('{headline} — tracked with Squish.', { headline: data.headline });
    const outcome = await shareCard(card.blob, friends ? `${words} ${inviteText(friends)} ${friends.link}` : words);
    if (outcome !== 'cancelled') unlock('first-share');
    if (outcome === 'downloaded') toast(t('Saved to your downloads'), '📥');
    if (outcome === 'shared') onClose();
  };

  const locked = (item: Decoration) => toast(whyLocked(item, PLUS), item.unlock.kind === 'achievement' ? '🔒' : '✨');
  // Grouped like the wardrobe: yours, earn these, Plus. "None" is always
  // theirs, so there is always a Yours shelf of frames to put it on.
  const frameShelves = shelves(FRAMES.filter((f) => decorOnShow(f, today)), entitlement);
  if (frameShelves[0]?.kind !== 'yours') frameShelves.unshift({ key: 'yours', kind: 'yours', title: t('Yours'), items: [] });
  const stickerShelves = shelves(STICKERS.filter((s) => decorOnShow(s, today)), entitlement);
  const noteFor = (kind: ShelfKind, item: Decoration) => (kind === 'earn' ? item.how : lockedNote(item.unlock));

  return (
    <Sheet open={open} onClose={onClose} title={t('Share your progress')}>
      <div className="share-body">
        {/* Off-canvas source artwork for the card, not decoration. */}
        <Squish ref={mascotRef} mood={data.mood} size={200} bob={false} className="share-source" />

        {card ? (
          <img className="share-preview" src={card.url} alt={t('{headline}. {subline}', { headline: data.headline, subline: data.subline })} />
        ) : failed ? (
          <p className="empty">{t('The card would not draw on this browser. Everything else still works.')}</p>
        ) : (
          <div className="skeleton share-preview" />
        )}

        <button type="button" className="btn btn--block" disabled={!card} onClick={() => void send()}>
          {t('Share')}
        </button>
        <p className="tiny muted center">
          {friends
            ? t('Your invite link goes with it: a friend who joins gets {period} of Squish Plus, and so do you.', { period: periodWords(friends.rewardDays) })
            : t('Made on your phone. Nothing is uploaded.')}
        </p>

        <div>
          <h4 className="small">{t('Frame')}</h4>
          {frameShelves.map((shelf) => (
            <Shelf key={shelf.key} title={shelf.title} kind={shelf.kind} subscribed={subscribed}>
              <div className="decor-grid decor-grid--frames" role="group" aria-label={t('Frames: {shelf}', { shelf: shelf.title })}>
                {shelf.kind === 'yours' && (
                  <button type="button" aria-pressed={decor.frame === ''} className={`decor decor--frame${decor.frame === '' ? ' decor--on' : ''}`} onClick={() => setShareDecor({ ...chosen, frame: '' })}>
                    <span className="decor-card" aria-hidden="true" />
                    <span className="tile-name">{t('None')}</span>
                    {decor.frame === '' && <span className="tile-note">{t('On')}</span>}
                  </button>
                )}
                {shelf.items.map((frame) => {
                  const mine = shelf.kind === 'yours';
                  const on = decor.frame === frame.id;
                  const note = on ? t('On') : noteFor(shelf.kind, frame);
                  return (
                    <button
                      key={frame.id}
                      type="button"
                      aria-pressed={mine ? on : undefined}
                      className={`decor decor--frame${on ? ' decor--on' : ''}${mine ? '' : ' decor--locked'}`}
                      onClick={() => (mine ? setShareDecor({ ...chosen, frame: frame.id }) : locked(frame))}
                      aria-label={mine ? t('{name} frame', { name: frame.name }) : t('{name} frame, locked — {how}', { name: frame.name, how: frame.how })}
                    >
                      <span className="decor-card" aria-hidden="true">
                        <img src={frameUrl(frame.id)} alt="" />
                      </span>
                      <span className="tile-name">{frame.name}</span>
                      {note && <span className="tile-note">{note}</span>}
                    </button>
                  );
                })}
              </div>
            </Shelf>
          ))}
        </div>

        <div>
          <h4 className="small">{t('Stickers')}</h4>
          <p className="tiny muted">{t('Up to two, either side of Squish.')}</p>
          {stickerShelves.map((shelf) => (
            <Shelf key={shelf.key} title={shelf.title} kind={shelf.kind} subscribed={subscribed}>
              <div className="decor-grid" role="group" aria-label={t('Stickers: {shelf}', { shelf: shelf.title })}>
                {shelf.items.map((sticker) => {
                  const mine = shelf.kind === 'yours';
                  const on = decor.stickers.includes(sticker.id);
                  const note = on ? t('On') : noteFor(shelf.kind, sticker);
                  return (
                    <button
                      key={sticker.id}
                      type="button"
                      aria-pressed={mine ? on : undefined}
                      className={`decor decor--sticker${on ? ' decor--on' : ''}${mine ? '' : ' decor--locked'}`}
                      onClick={() => (mine ? setShareDecor({ ...chosen, stickers: toggleSticker(decor.stickers, sticker.id) }) : locked(sticker))}
                      aria-label={mine ? sticker.name : t('{name}, locked — {how}', { name: sticker.name, how: sticker.how })}
                    >
                      <img src={stickerUrl(sticker.id)} alt="" />
                      <span className="tile-name">{sticker.name}</span>
                      {note && <span className="tile-note">{note}</span>}
                    </button>
                  );
                })}
              </div>
            </Shelf>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

export default ShareSheet;
