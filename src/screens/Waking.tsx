import { useEffect, useState } from 'react';
import Squish from '../components/Squish';
import './waking.css';

/**
 * Shown while the app is waiting for the server's first answer.
 *
 * Normally that is a few hundred milliseconds and nobody sees this. On a
 * sleeping free-tier host the first request can take the best part of a
 * minute, so rather than a blank screen the wait explains itself.
 */
export default function Waking() {
  const [phase, setPhase] = useState<'quiet' | 'waiting' | 'slow'>('quiet');

  useEffect(() => {
    // Stay blank briefly so a fast load does not flash a spinner.
    const soon = setTimeout(() => setPhase('waiting'), 600);
    const later = setTimeout(() => setPhase('slow'), 4000);
    return () => {
      clearTimeout(soon);
      clearTimeout(later);
    };
  }, []);

  if (phase === 'quiet') return <div className="app" />;

  return (
    <div className="app waking">
      <div className="waking-body">
        <Squish mood="sleepy" size={148} />
        <h1>Just a moment…</h1>
        {phase === 'slow' && (
          <p className="muted center waking-note">
            Squish has been napping. The first visit of the day takes up to a minute — after that it’s quick.
          </p>
        )}
      </div>
    </div>
  );
}
