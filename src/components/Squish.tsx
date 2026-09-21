import { useId, useMemo, type CSSProperties, type Ref } from 'react';
import type { Mood } from '../types';
import { MASCOT_ART, MASCOT_VIEWBOX } from './squish-art';
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
}

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
export function Squish({ mood = 'excited', size = 140, heart = false, bob = true, className = '', style, label, ref }: Props) {
  // Two mascots on one page would otherwise fight over `url(#skin)`.
  const instance = useId().replace(/[^a-zA-Z0-9]/g, '');

  const markup = useMemo(
    () => MASCOT_ART[mood].replaceAll('__ID__', `${instance}-`) + (heart ? HEART : ''),
    [mood, heart, instance],
  );

  return (
    <svg
      ref={ref}
      className={`squish ${bob ? 'squish--bob' : ''} squish--${mood} ${className}`}
      style={{ width: size, height: size, ...style }}
      viewBox={MASCOT_VIEWBOX}
      role="img"
      aria-label={label ?? `Squish looking ${mood}`}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export default Squish;
