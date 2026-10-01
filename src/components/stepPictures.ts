import type { StepAction } from '../lib/cooking';

/** One painted scene per kind of step, from design/cook (see its README). */
const PAINTED = import.meta.glob<string>('../assets/cook/*.webp', { query: '?url', import: 'default', eager: true });

/** A kind of step's picture, or undefined: other has none, and a new kind none until it is painted. */
export const pictureFor = (action: StepAction): string | undefined => PAINTED[`../assets/cook/${action}.webp`];

/** Whether this kind of step has a picture: a step of a kind without one is shown without. */
export const hasArt = (action: StepAction): boolean => pictureFor(action) !== undefined;
