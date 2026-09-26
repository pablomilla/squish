import { useId, useMemo, type CSSProperties, type Ref } from 'react';
import type { Mood } from '../types';
import { MASCOT_ART, MASCOT_VIEWBOX } from './squish-art';
import { finishGradient, lookById, lookVars } from '../lib/looks';
import { SLOTS, dress, riseOf, wearable, type AccessoryArt, type Outfit, type Slot } from '../lib/outfit';
import { useSquish } from '../store/useSquish';
import { useAccessoryArt } from './accessories';
import { useSubscribed } from './useSubscribed';
import './squish.css';

interface Props {
  mood?: Mood;
  size?: number;
  /** A floating heart alongside, for the welcome and lock screens. */
  heart?: boolean;
  bob?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
  /** Needed so a share card can rasterise the artwork already on the page. */
  ref?: Ref<SVGSVGElement>;
  /** Wear this look rather than the chosen one — for showing off a colourway in the picker. */
  look?: string;
  /**
   * Wear exactly this rather than what they have on — for the accessory
   * picker, which shows an item on Squish before it is theirs.
   */
  outfit?: Outfit;
}

const lessMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** The two gradients a finish replaces: the body's, and the arms'. */
const SKIN = /<linearGradient id="__ID__skin"[\s\S]*?<\/linearGradient>/;
const ARM = /<linearGradient id="__ID__arm"[\s\S]*?<\/linearGradient>/;

/**
 * Wrapped in a bare group rather than transformed directly: a CSS animation
 * would replace this placement transform outright instead of composing with it,
 * and the heart would beat its way back to the top-left corner.
 */
const HEART =
  '<g class="sq-heart"><g transform="translate(386 44) scale(4.6)">' +
  '<path d="M12 21.6 3.9 13.3a5.2 5.2 0 0 1 0-7.4 5.2 5.2 0 0 1 7.4 0l.7.7.7-.7a5.2 5.2 0 0 1 7.4 0 5.2 5.2 0 0 1 0 7.4Z" fill="#F4899F"/>' +
  '</g></g>';

/**
 * The Squish mascot: seven complete poses, drawn as vector artwork.
 *
 * Each mood is a whole pose rather than one body wearing a different face —
 * sleepy is curled over, thinking leans on an arm — so they are swapped
 * wholesale. The markup is inlined rather than loaded through an `<img>`
 * because three things depend on reaching inside it: the blink, the dark-mode
 * skin, and the share card, which rasterises whichever mascot is on screen.
 *
 * The markup comes from `squish-art.ts`, generated at build time from our own
 * artwork files — it is a fixed asset, not anything a person can supply.
 */
export function Squish({ mood = 'excited', size = 140, heart = false, bob = true, className = '', style, label, ref, look, outfit }: Props) {
  // Two mascots on one page would otherwise fight over `url(#skin)`.
  const instance = useId().replace(/[^a-zA-Z0-9]/g, '');
  const chosen = useSquish((s) => s.look);
  const wornLook = lookById(look ?? chosen);
  const finish = wornLook.finish;
  // A plain colour is painted through the skin custom properties, which the
  // app sets once, on the page, for the colour somebody has chosen. A Squish
  // asked to wear a particular colour — a tile in the picker — sets its own,
  // or every tile would show the chosen colour. The theme is read from the
  // page, which is where useAppliedTheme puts it.
  const ownColour =
    look && !finish
      ? (lookVars(wornLook, typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark') as CSSProperties)
      : undefined;

  // What they have on, less anything they may not wear today: a lapsed
  // subscription or an ended season takes the item off without anything
  // having to go and tidy the choice away.
  const chosenOutfit = useSquish((s) => s.outfit);
  const unlocked = useSquish((s) => s.unlocked);
  const subscribed = useSubscribed();
  const worn = outfit ?? wearable(chosenOutfit, { unlocked, subscribed, today: new Date() });
  const ids = SLOTS.map(({ id }) => worn[id]).filter((id): id is string => Boolean(id));
  const art = useAccessoryArt(ids);
  const layers: Partial<Record<Slot, AccessoryArt>> = {};
  for (const { id: slot } of SLOTS) {
    const item = worn[slot];
    const loaded = item ? art.get(item) : undefined;
    if (loaded) layers[slot] = loaded;
  }
  const dressedIn = SLOTS.map(({ id }) => (layers[id] ? worn[id] : '')).join(' ');

  const markup = useMemo(() => {
    let art = dress(MASCOT_ART[mood], mood, layers);
    // A finish repaints the body and arms and nothing else; the colours of a
    // plain look arrive through the skin custom properties instead.
    if (finish) {
      const still = lessMotion();
      art = art.replace(SKIN, finishGradient('__ID__skin', finish, still)).replace(ARM, finishGradient('__ID__arm', finish, still));
    }
    return art.replaceAll('__ID__', `${instance}-`) + (heart ? HEART : '');
    // `layers` is rebuilt every render; what it holds is exactly `dressedIn`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood, heart, instance, finish, dressedIn]);

  return (
    <svg
      ref={ref}
      className={`squish ${bob ? 'squish--bob' : ''} squish--${mood} ${className}`}
      style={{ width: size, height: size, ...ownColour, ...style }}
      viewBox={MASCOT_VIEWBOX}
      data-rise={layers.head ? riseOf(worn) || undefined : undefined}
      role="img"
      aria-label={label ?? `Squish looking ${mood}`}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export default Squish;
