import type { ReactNode } from 'react';
import type { Mood } from '../types';
import Squish from './Squish';

/**
 * One empty state, used everywhere.
 *
 * Every screen had improvised its own, so a blank day, a blank favourites list
 * and a blank chart each looked like a different app. A mood, a sentence and at
 * most one thing to do.
 */
export function EmptyState({
  mood = 'calm',
  size = 92,
  children,
  action,
}: {
  mood?: Mood;
  size?: number;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Squish mood={mood} size={size} bob={false} />
      <p>{children}</p>
      {action}
    </div>
  );
}

export default EmptyState;
