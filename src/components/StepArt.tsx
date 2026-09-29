import type { StepAction } from '../lib/cooking';
import './step-art.css';

/** One painted scene per action, from design/cook (see its README). */
const PAINTED = import.meta.glob<string>('../assets/cook/*.webp', { query: '?url', import: 'default', eager: true });

/**
 * What a cooking step does, as a picture — a board and knife for chopping, a
 * pan on the hob for frying — with the step's own foods in it: the broccoli
 * on the board, the rice in the pot, the salmon on the oven tray. A step that
 * names no food shows the scene empty.
 *
 * Decoration: the step's words and its ingredient list say everything, so it
 * is hidden from screen readers.
 */
export default function StepArt({ action, foods = [] }: { action: StepAction; foods?: string[] }) {
  const place = PLACES[action];
  const url = PAINTED[`../assets/cook/${action}.webp`];
  const width = Math.min(BOX.width, BOX.height * place.aspect);
  const height = width / place.aspect;
  const x = BOX.cx - width / 2;
  const y = BOX.cy - height / 2;
  const shown = foods.slice(0, place.spots.length);
  return (
    <svg className={`step-art step-art--${action}`} viewBox="0 0 240 160" aria-hidden="true" focusable="false">
      <ellipse className="sa-blob" cx="120" cy="84" rx="96" ry="66" />
      {url && <image href={url} x={x} y={y} width={width} height={height} preserveAspectRatio="xMidYMid meet" />}
      {shown.length > 0 && (
        <g className={`sa-foods sa-foods--${action}`}>
          {shown.map((emoji, i) => {
            const [u, v, size] = place.spots[i];
            return (
              <text key={i} className="sa-emoji" style={{ animationDelay: `${i * 0.3}s` }} x={x + u * width} y={y + v * height} fontSize={size} textAnchor="middle" dominantBaseline="central">
                {emoji}
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
}

/** The box each picture is fitted into, centred on the blob. */
const BOX = { width: 212, height: 150, cx: 120, cy: 82 };

/**
 * Where the foods sit on each picture: its shape (width over height), and
 * each spot as a share of the picture's width and height, with a size in the
 * drawing's own units. As many spots as the scene has room for.
 */
interface Place {
  aspect: number;
  spots: [number, number, number][];
}

const PLACES: Record<StepAction, Place> = {
  prep: { aspect: 720 / 431, spots: [[0.26, 0.46, 30], [0.41, 0.5, 28], [0.55, 0.44, 26]] },
  rinse: { aspect: 720 / 523, spots: [[0.3, 0.46, 26], [0.53, 0.56, 26], [0.72, 0.45, 24]] },
  mix: { aspect: 720 / 527, spots: [[0.24, 0.42, 28], [0.38, 0.52, 26], [0.34, 0.28, 24]] },
  season: { aspect: 720 / 600, spots: [[0.32, 0.62, 28], [0.46, 0.72, 26], [0.2, 0.54, 24]] },
  boil: { aspect: 720 / 590, spots: [[0.3, 0.41, 24], [0.43, 0.43, 24], [0.55, 0.4, 22]] },
  fry: { aspect: 720 / 485, spots: [[0.29, 0.38, 28], [0.44, 0.37, 26], [0.36, 0.28, 24]] },
  bake: { aspect: 720 / 572, spots: [[0.43, 0.5, 24], [0.55, 0.5, 24], [0.49, 0.44, 22]] },
  grill: { aspect: 720 / 451, spots: [[0.33, 0.42, 30], [0.46, 0.38, 28], [0.57, 0.45, 26]] },
  blend: { aspect: 720 / 1094, spots: [[0.38, 0.44, 24], [0.56, 0.42, 22], [0.47, 0.3, 22]] },
  rest: { aspect: 720 / 425, spots: [[0.36, 0.4, 30], [0.5, 0.38, 28], [0.43, 0.5, 26]] },
  serve: { aspect: 720 / 394, spots: [[0.42, 0.5, 30], [0.58, 0.52, 28], [0.5, 0.4, 24], [0.5, 0.62, 22]] },
};
