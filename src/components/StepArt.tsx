import type { StepAction } from '../lib/cooking';
import './step-art.css';

/** One painted scene per action, from design/cook (see its README). */
const PAINTED = import.meta.glob<string>('../assets/cook/*.webp', { query: '?url', import: 'default', eager: true });

/**
 * What a cooking step does, as a picture: a board and knife for chopping, a
 * pan on the hob for frying, on a soft blob in the app's own colour.
 *
 * Decoration: the step's words and its ingredient list say everything, so it
 * is hidden from screen readers.
 */
export default function StepArt({ action }: { action: StepAction }) {
  const url = PAINTED[`../assets/cook/${action}.webp`];
  return (
    <svg className={`step-art step-art--${action}`} viewBox="0 0 240 160" aria-hidden="true" focusable="false">
      <ellipse className="sa-blob" cx="120" cy="84" rx="96" ry="66" />
      {url && <image href={url} x="14" y="7" width="212" height="150" preserveAspectRatio="xMidYMid meet" />}
    </svg>
  );
}
