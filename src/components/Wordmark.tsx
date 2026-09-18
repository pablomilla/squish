import { useId, useMemo, type CSSProperties } from 'react';
import { WORDMARK_ART, WORDMARK_VIEWBOX } from './squish-art';
import './squish.css';

/**
 * The Squish logotype: traced lettering with a heart over the "i".
 *
 * Not the Fredoka typeface set in a heading — this is drawn artwork, so it
 * keeps its shape whatever fonts a phone has loaded, and it is the same mark
 * that goes on the store listings.
 */
export function Wordmark({ width = 200, className = '', style }: { width?: number; className?: string; style?: CSSProperties }) {
  const instance = useId().replace(/[^a-zA-Z0-9]/g, '');
  const markup = useMemo(() => WORDMARK_ART.replaceAll('__ID__', `${instance}-`), [instance]);
  const [, , w, h] = WORDMARK_VIEWBOX.split(' ').map(Number);

  return (
    <svg
      className={`wordmark ${className}`}
      style={{ width, height: (width * h) / w, ...style }}
      viewBox={WORDMARK_VIEWBOX}
      role="img"
      aria-label="Squish"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export default Wordmark;
