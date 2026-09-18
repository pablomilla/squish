import type { CSSProperties, Ref } from 'react';
import type { Mood } from '../types';
import './squish.css';

interface Props {
  mood?: Mood;
  size?: number;
  /** Hugs a heart, like the hero illustration. */
  heart?: boolean;
  bob?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
  /** Needed so a share card can rasterise the artwork already on the page. */
  ref?: Ref<SVGSVGElement>;
}

/** A soft blob: narrow top, round belly, two little feet. */
const BODY =
  'M100 16c-38 0-60 32-64 76-4 34-16 58-14 76 2 18 22 28 46 28 16 0 22-6 32-6s16 6 32 6c24 0 44-10 46-28 2-18-10-42-14-76-4-44-26-76-64-76z';

const EYE_Y = 104;
const MOUTH_Y = 128;

function Eyes({ mood }: { mood: Mood }) {
  const curve = { stroke: 'var(--squish-ink)', strokeWidth: 7, strokeLinecap: 'round' as const, fill: 'none' };

  if (mood === 'sleepy' || mood === 'calm' || mood === 'nomnom') {
    return (
      <g {...curve}>
        <path d={`M64 ${EYE_Y}q11-11 22 0`} />
        <path d={`M114 ${EYE_Y}q11-11 22 0`} />
      </g>
    );
  }
  if (mood === 'excited' || mood === 'cheering') {
    return (
      <g {...curve}>
        <path d={`M64 ${EYE_Y + 4}q11 12 22 0`} />
        <path d={`M114 ${EYE_Y + 4}q11 12 22 0`} />
      </g>
    );
  }
  return (
    <g className="squish-eyes" fill="var(--squish-ink)">
      <ellipse cx="75" cy={mood === 'thinking' ? EYE_Y - 2 : EYE_Y} rx="7" ry="9" />
      <ellipse cx="125" cy={mood === 'thinking' ? EYE_Y - 5 : EYE_Y} rx="7" ry="9" />
      <circle cx="77.6" cy={EYE_Y - 4} r="2.3" fill="#fff" />
      <circle cx="127.6" cy={EYE_Y - 7} r="2.3" fill="#fff" />
    </g>
  );
}

function Mouth({ mood }: { mood: Mood }) {
  if (mood === 'nomnom') return <ellipse cx="100" cy={MOUTH_Y} rx="12" ry="10" fill="var(--squish-ink)" />;
  if (mood === 'sleepy') {
    return <path d={`M92 ${MOUTH_Y}q8 8 16 0`} stroke="var(--squish-ink)" strokeWidth="6" strokeLinecap="round" fill="none" />;
  }
  if (mood === 'calm' || mood === 'thinking') {
    return <path d={`M87 ${MOUTH_Y - 3}q13 11 26 0`} stroke="var(--squish-ink)" strokeWidth="6" strokeLinecap="round" fill="none" />;
  }
  return (
    <g>
      <path d={`M84 ${MOUTH_Y - 6}q16 24 32 0z`} fill="var(--squish-ink)" />
      <path d={`M94 ${MOUTH_Y + 8}q6 6 12 0z`} fill="#f0788f" />
    </g>
  );
}

function Arms({ mood, heart }: { mood: Mood; heart: boolean }) {
  const fill = 'var(--squish-skin-2)';
  if (heart) {
    return (
      <g fill={fill}>
        <ellipse cx="62" cy="150" rx="17" ry="15" transform="rotate(-18 62 150)" />
        <ellipse cx="138" cy="150" rx="17" ry="15" transform="rotate(18 138 150)" />
      </g>
    );
  }
  if (mood === 'cheering' || mood === 'excited') {
    return (
      <g fill={fill}>
        <ellipse cx="22" cy="126" rx="14" ry="18" transform="rotate(-32 22 126)" />
        <ellipse cx="178" cy="126" rx="14" ry="18" transform="rotate(32 178 126)" />
      </g>
    );
  }
  if (mood === 'proud') {
    return (
      <g fill={fill}>
        <ellipse cx="24" cy="150" rx="18" ry="14" />
        <ellipse cx="176" cy="150" rx="18" ry="14" />
      </g>
    );
  }
  return (
    <g fill={fill}>
      <ellipse cx="22" cy="158" rx="15" ry="17" />
      <ellipse cx="178" cy="158" rx="15" ry="17" />
    </g>
  );
}

const HEART =
  'M0 22C-25 5-35-7-35-19c0-11 11-17 21-13 6 2 11 7 14 12 3-5 8-10 14-12 10-4 21 2 21 13C35-7 25 5 0 22z';

function Accessory({ mood, heart }: { mood: Mood; heart: boolean }) {
  return (
    <>
      {heart && (
        <g transform="translate(100 156) scale(0.92)">
          <path className="squish-heart" d={HEART} fill="var(--squish-pink)" />
        </g>
      )}

      {mood === 'nomnom' && (
        <g transform="translate(140 132) rotate(16) scale(0.9)">
          <path d="M0 0a26 26 0 0 0 44 0z" fill="#f1687f" />
          <path d="M0 0a26 26 0 0 0 44 0" fill="none" stroke="#7dc79a" strokeWidth="6" />
          <circle cx="16" cy="10" r="2.4" fill="#3a2a3c" />
          <circle cx="28" cy="8" r="2.4" fill="#3a2a3c" />
        </g>
      )}

      {mood === 'sleepy' && (
        <g fill="var(--squish-ink)" className="squish-zzz" fontFamily="Fredoka, sans-serif" fontWeight="600">
          <text x="150" y="62" fontSize="19">z</text>
          <text x="166" y="42" fontSize="25">Z</text>
        </g>
      )}

      {(mood === 'sleepy' || mood === 'calm') && <path d="M100 18c11-13 27-10 31 0-9 11-23 13-31 0z" fill="#7dc79a" />}

      {(mood === 'excited' || mood === 'cheering') && (
        <g stroke="var(--squish-spark)" strokeWidth="6" strokeLinecap="round">
          <path d="M22 54 8 46" />
          <path d="M28 36 22 22" />
          <path d="m178 54 14-8" />
          <path d="m172 36 6-14" />
        </g>
      )}

      {mood === 'proud' && (
        <g transform="translate(164 46) scale(0.5)">
          <path className="squish-heart" d={HEART} fill="var(--squish-pink)" />
        </g>
      )}

      {mood === 'thinking' && (
        <g fill="var(--squish-ink)" opacity="0.55" className="squish-think">
          <circle cx="158" cy="60" r="4" />
          <circle cx="172" cy="46" r="6" />
          <circle cx="188" cy="28" r="8" />
        </g>
      )}
    </>
  );
}

/**
 * The Squish mascot. One blob, many moods — the app's main source of warmth.
 */
export function Squish({ mood = 'excited', size = 140, heart = false, bob = true, className = '', style, label, ref }: Props) {
  return (
    <svg
      ref={ref}
      className={`squish ${bob ? 'squish--bob' : ''} squish--${mood} ${className}`}
      style={{ width: size, height: size, ...style }}
      viewBox="0 0 200 212"
      role="img"
      aria-label={label ?? `Squish looking ${mood}`}
    >
      <defs>
        <radialGradient id="squish-body" cx="38%" cy="26%" r="82%">
          <stop offset="0%" stopColor="var(--squish-skin-0)" />
          <stop offset="58%" stopColor="var(--squish-skin-1)" />
          <stop offset="100%" stopColor="var(--squish-skin-2)" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="200" rx="56" ry="9" fill="var(--squish-shadow)" />
      {!heart && <Arms mood={mood} heart={false} />}
      <path d={BODY} fill="url(#squish-body)" />
      <ellipse cx="72" cy="52" rx="17" ry="12" fill="#fff" opacity="0.4" transform="rotate(-24 72 52)" />
      <ellipse cx="58" cy={MOUTH_Y - 4} rx="13" ry="8" fill="var(--squish-blush)" />
      <ellipse cx="142" cy={MOUTH_Y - 4} rx="13" ry="8" fill="var(--squish-blush)" />
      <Eyes mood={mood} />
      <Mouth mood={mood} />
      <Accessory mood={mood} heart={heart} />
      {heart && <Arms mood={mood} heart />}
    </svg>
  );
}

export default Squish;
