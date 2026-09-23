import { useEffect, useState } from 'react';
import Squish from '../components/Squish';
import './waking.css';

/**
 * Shown while the app is waiting for the server's first answer.
 *
 * It takes over from the splash in index.html — the same hopping Squish, in
 * the same place, so the handover does not jump — and usually lasts a moment.
 * On a sleeping free-tier host the first request can take the best part of a
 * minute, so after a few seconds the wait explains itself: Squish curls up
 * and is shown waking, which is what the server is doing.
 */
type Phase = 'hello' | 'waiting' | 'slow';

const BUBBLES = [
  { left: '6%', size: 14, delay: 0, duration: 5.2 },
  { left: '18%', size: 9, delay: 1.3, duration: 4.4 },
  { left: '30%', size: 7, delay: 2.6, duration: 4.0 },
  { left: '68%', size: 8, delay: 0.5, duration: 4.6 },
  { left: '78%', size: 12, delay: 1.9, duration: 5.6 },
  { left: '90%', size: 10, delay: 3.1, duration: 4.8 },
  { left: '44%', size: 6, delay: 3.8, duration: 4.2 },
];

export default function Waking() {
  const [phase, setPhase] = useState<Phase>('hello');

  useEffect(() => {
    // Words only once it is clearly a wait: a fast load is just Squish, hopping.
    const soon = setTimeout(() => setPhase('waiting'), 600);
    const later = setTimeout(() => setPhase('slow'), 4000);
    return () => {
      clearTimeout(soon);
      clearTimeout(later);
    };
  }, []);

  const napping = phase === 'slow';

  return (
    <div className="app waking">
      <div className="waking-body" role="status" aria-live="polite" aria-label={napping ? 'Squish is waking up' : 'Squish is loading'}>
        <div className="waking-stack">
          <div className="waking-stage">
            {napping && (
              // Started part-way through their rise, so there are bubbles already on the way up.
              <div className="waking-bubbles" aria-hidden="true">
                {BUBBLES.map((b) => (
                  <span
                    key={b.left}
                    style={{ left: b.left, width: b.size, height: b.size, animationDelay: `-${b.delay}s`, animationDuration: `${b.duration}s` }}
                  />
                ))}
              </div>
            )}
            {napping ? (
              <div className="waking-nap" key="nap">
                <Squish mood="sleepy" size={176} bob={false} label="Squish, asleep" />
              </div>
            ) : (
              <div className="waking-hop" key="hop">
                <Squish mood="excited" size={176} bob={false} label="Squish" />
              </div>
            )}
          </div>
          <div className={napping ? 'waking-shadow waking-shadow--still' : 'waking-shadow'} />
          <div className="waking-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>

          {/* Below the stack rather than in it, so words arriving do not move Squish. */}
          <div className="waking-words">
            {phase === 'waiting' && <h1>Just a moment…</h1>}
            {napping && (
              <>
                <h1>Squish is waking up…</h1>
                <p className="muted center waking-note">
                  Squish has been napping. The first visit of the day takes up to a minute — after that it’s quick.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
