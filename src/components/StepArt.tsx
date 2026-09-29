import type { ReactNode } from 'react';
import type { StepAction } from '../lib/cooking';
import './step-art.css';

/**
 * A small drawing of what a cooking step does — a board and knife for
 * chopping, a pot with steam for boiling — so cook mode's one step is not
 * a line of text on an empty screen. Drawn from the app's own colours, so
 * it follows light and dark, and still when motion is turned down.
 *
 * Decoration: the step's words say everything, so it is hidden from screen
 * readers.
 */
export default function StepArt({ action }: { action: StepAction }) {
  return (
    <svg className={`step-art step-art--${action}`} viewBox="0 0 240 160" aria-hidden="true" focusable="false">
      <ellipse className="sa-blob" cx="120" cy="84" rx="96" ry="66" />
      {SCENES[action]}
    </svg>
  );
}

/** Three wisps rising, for anything hot. */
const Steam = ({ x, y }: { x: number; y: number }) => (
  <g className="sa-steam">
    {[-18, 0, 18].map((dx, i) => (
      <path key={dx} className="sa-wisp" style={{ animationDelay: `${i * 0.5}s` }} d={`M${x + dx} ${y} c-6 -8 6 -14 0 -22 c-6 -8 6 -14 0 -22`} />
    ))}
  </g>
);

const SCENES: Record<StepAction, ReactNode> = {
  prep: (
    <g>
      <rect className="sa-board" x="44" y="88" width="152" height="40" rx="14" />
      <circle className="sa-board-hole" cx="182" cy="108" r="5" />
      <circle className="sa-veg sa-mint" cx="78" cy="102" r="11" />
      <circle className="sa-veg sa-mint" cx="100" cy="104" r="10" />
      <circle className="sa-veg sa-peach" cx="120" cy="106" r="9" />
      <g className="sa-knife">
        <path className="sa-blade" d="M128 78 L184 60 Q192 58 190 66 L136 92 Z" />
        <rect className="sa-handle" x="182" y="50" width="30" height="12" rx="6" transform="rotate(-18 182 50)" />
      </g>
    </g>
  ),
  rinse: (
    <g>
      <g className="sa-drops">
        {[96, 118, 140].map((x, i) => (
          <path key={x} className="sa-drop" style={{ animationDelay: `${i * 0.35}s` }} d={`M${x} 36 q6 10 0 14 q-6 -4 0 -14 Z`} />
        ))}
      </g>
      <path className="sa-bowl" d="M62 76 H178 Q176 128 120 130 Q64 128 62 76 Z" />
      {[88, 108, 132, 152].map((x) => (
        <circle key={x} className="sa-hole" cx={x} cy="100" r="4" />
      ))}
      <rect className="sa-rim" x="54" y="70" width="132" height="10" rx="5" />
    </g>
  ),
  mix: (
    <g>
      <path className="sa-bowl" d="M58 78 H182 Q180 132 120 134 Q60 132 58 78 Z" />
      <ellipse className="sa-mix" cx="120" cy="80" rx="58" ry="10" />
      <path className="sa-swirl" d="M92 80 q14 -10 28 0 q14 10 28 0" />
      <g className="sa-spoon">
        <rect className="sa-handle" x="130" y="26" width="10" height="64" rx="5" transform="rotate(28 130 26)" />
        <ellipse className="sa-handle" cx="112" cy="84" rx="9" ry="13" transform="rotate(28 112 84)" />
      </g>
    </g>
  ),
  season: (
    <g>
      <g className="sa-shaker" transform="rotate(-28 140 70)">
        <rect className="sa-jar" x="120" y="44" width="40" height="56" rx="10" />
        <rect className="sa-lid" x="118" y="36" width="44" height="14" rx="6" />
        <circle className="sa-hole-dark" cx="132" cy="43" r="2" />
        <circle className="sa-hole-dark" cx="140" cy="43" r="2" />
        <circle className="sa-hole-dark" cx="148" cy="43" r="2" />
      </g>
      <g className="sa-grains">
        {[
          [98, 64], [106, 78], [92, 84], [102, 96], [88, 102], [96, 112],
        ].map(([x, y], i) => (
          <circle key={i} className="sa-grain" style={{ animationDelay: `${i * 0.18}s` }} cx={x} cy={y} r="3" />
        ))}
      </g>
      <ellipse className="sa-plate" cx="96" cy="128" rx="54" ry="10" />
    </g>
  ),
  boil: (
    <g>
      <Steam x={120} y={58} />
      <rect className="sa-pot" x="66" y="64" width="108" height="64" rx="14" />
      <rect className="sa-handle" x="52" y="74" width="18" height="10" rx="5" />
      <rect className="sa-handle" x="170" y="74" width="18" height="10" rx="5" />
      <rect className="sa-water" x="74" y="72" width="92" height="12" rx="6" />
      {[92, 116, 140].map((x, i) => (
        <circle key={x} className="sa-bubble" style={{ animationDelay: `${i * 0.4}s` }} cx={x} cy="96" r="5" />
      ))}
      <rect className="sa-hob" x="58" y="130" width="124" height="8" rx="4" />
    </g>
  ),
  fry: (
    <g>
      <g className="sa-sizzle">
        <path className="sa-wisp" d="M86 60 l6 -10 M104 54 l2 -12 M126 54 l-2 -12 M146 60 l-6 -10" />
      </g>
      <ellipse className="sa-pan" cx="110" cy="96" rx="62" ry="24" />
      <ellipse className="sa-pan-in" cx="110" cy="92" rx="52" ry="16" />
      <rect className="sa-handle" x="168" y="86" width="52" height="12" rx="6" />
      <ellipse className="sa-food sa-peach" cx="92" cy="90" rx="14" ry="7" />
      <ellipse className="sa-food sa-mint" cx="120" cy="94" rx="10" ry="6" />
      <ellipse className="sa-food sa-yellow" cx="136" cy="88" rx="8" ry="5" />
    </g>
  ),
  bake: (
    <g>
      <rect className="sa-oven" x="56" y="34" width="128" height="104" rx="16" />
      <rect className="sa-panel" x="56" y="34" width="128" height="22" rx="11" />
      <circle className="sa-knob" cx="78" cy="45" r="5" />
      <circle className="sa-knob" cx="98" cy="45" r="5" />
      <rect className="sa-window" x="72" y="66" width="96" height="56" rx="10" />
      <rect className="sa-tray" x="84" y="100" width="72" height="8" rx="4" />
      <ellipse className="sa-food sa-peach" cx="104" cy="96" rx="12" ry="6" />
      <ellipse className="sa-food sa-mint" cx="134" cy="96" rx="12" ry="6" />
    </g>
  ),
  grill: (
    <g>
      <g className="sa-flames">
        {[84, 110, 136, 160].map((x, i) => (
          <path key={x} className="sa-flame" style={{ animationDelay: `${i * 0.25}s` }} d={`M${x} 132 q-10 -14 0 -26 q10 12 0 26 Z`} />
        ))}
      </g>
      {[72, 92, 112, 132, 152].map((x) => (
        <rect key={x} className="sa-bar" x={x} y="70" width="8" height="40" rx="4" transform={`skewX(-8)`} />
      ))}
      <rect className="sa-rim" x="52" y="96" width="136" height="8" rx="4" />
      <ellipse className="sa-food sa-peach" cx="100" cy="86" rx="22" ry="9" />
      <path className="sa-char" d="M88 82 l8 8 M98 80 l8 8 M108 80 l8 8" />
      <ellipse className="sa-food sa-mint" cx="150" cy="86" rx="16" ry="8" />
    </g>
  ),
  blend: (
    <g>
      <path className="sa-jug" d="M88 36 H152 L144 108 H96 Z" />
      <path className="sa-swirl" d="M104 84 q16 -14 32 0 M108 64 q12 -10 24 0" />
      <rect className="sa-lid" x="84" y="28" width="72" height="12" rx="6" />
      <rect className="sa-base" x="84" y="108" width="72" height="26" rx="8" />
      <circle className="sa-knob" cx="120" cy="121" r="5" />
    </g>
  ),
  rest: (
    <g>
      <circle className="sa-clock" cx="120" cy="78" r="44" />
      <circle className="sa-clock-in" cx="120" cy="78" r="36" />
      <path className="sa-hands" d="M120 78 V54 M120 78 L136 88" />
      <circle className="sa-knob" cx="120" cy="78" r="4" />
      <rect className="sa-plate" x="70" y="126" width="100" height="8" rx="4" />
    </g>
  ),
  serve: (
    <g>
      <g className="sa-sparkles">
        <path className="sa-sparkle" d="M64 48 l4 -10 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 Z" />
        <path className="sa-sparkle" style={{ animationDelay: '0.6s' }} d="M176 40 l3 -7 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 Z" />
      </g>
      <ellipse className="sa-plate" cx="120" cy="100" rx="64" ry="28" />
      <ellipse className="sa-plate-in" cx="120" cy="96" rx="46" ry="18" />
      <ellipse className="sa-food sa-peach" cx="108" cy="92" rx="16" ry="8" />
      <ellipse className="sa-food sa-mint" cx="132" cy="96" rx="14" ry="7" />
      <circle className="sa-food sa-yellow" cx="122" cy="84" r="6" />
      <rect className="sa-handle" x="36" y="80" width="8" height="46" rx="4" />
      <rect className="sa-handle" x="196" y="80" width="8" height="46" rx="4" />
    </g>
  ),
};
