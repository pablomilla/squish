import type { StepAction } from '../lib/cooking';
import { pictureFor } from './stepPictures';
import './step-art.css';

/**
 * What a cooking step does, as a picture: a board and knife for chopping, a
 * pan on the hob for frying, on a soft blob in the app's own colour.
 *
 * Decoration: the step's words and its ingredient list say everything, so it
 * is hidden from screen readers.
 */
export default function StepArt({ action }: { action: StepAction }) {
  const url = pictureFor(action);
  if (!url) return null;
  return (
    <svg className={`step-art step-art--${action}`} viewBox="0 0 240 160" aria-hidden="true" focusable="false">
      <ellipse className="sa-blob" cx="120" cy="84" rx="96" ry="66" />
      <image href={url} x="14" y="7" width="212" height="150" preserveAspectRatio="xMidYMid meet" />
    </svg>
  );
}
