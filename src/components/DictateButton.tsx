import { useEffect, useRef, useState } from 'react';
import { MicIcon, StopIcon } from './icons';
import { speechSupported, startDictation } from '../lib/speech';
import './dictate.css';

interface Props {
  /** Given the dictated words, to append or replace as the caller sees fit. */
  onText: (text: string) => void;
  onError?: (message: string) => void;
  /** What is being dictated, for the screen reader. */
  label?: string;
}

/**
 * Hold-free dictation: press to start, press again to stop.
 *
 * Not a press-and-hold, which is the obvious design and the wrong one — saying
 * what you had for dinner takes longer than a thumb wants to stay still, and
 * the listing pauses that make people lift their finger are exactly the pauses
 * in the middle of a sentence.
 *
 * It renders nothing at all where the browser has no speech recognition, so
 * the caller can drop it in beside a text box without a fallback of its own.
 */
export default function DictateButton({ onText, onError, label = 'your meal' }: Props) {
  const [supported] = useState(speechSupported);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const session = useRef<{ stop(): void } | null>(null);

  // A microphone that outlives the screen it was opened on is the kind of bug
  // people write app-store reviews about.
  useEffect(() => () => session.current?.stop(), []);

  if (!supported) return null;

  const stop = () => {
    session.current?.stop();
    session.current = null;
  };

  const start = () => {
    setHeard('');
    const started = startDictation({
      onChange: ({ final, interim }) => setHeard([final, interim].filter(Boolean).join(' ')),
      onEnd: (final) => {
        session.current = null;
        setListening(false);
        setHeard('');
        if (final) onText(final);
      },
      onError: (message) => {
        session.current = null;
        setListening(false);
        setHeard('');
        onError?.(message);
      },
    });

    if (!started) {
      onError?.('Dictation would not start. Typing still works.');
      return;
    }
    session.current = started;
    setListening(true);
  };

  return (
    <div className="dictate">
      <button
        type="button"
        className={`btn btn--soft dictate-btn ${listening ? 'is-live' : ''}`}
        onClick={listening ? stop : start}
        aria-pressed={listening}
        aria-label={listening ? 'Stop dictating' : `Dictate ${label}`}
        title={
          listening
            ? 'Stop dictating'
            : 'Say it instead of typing. Your browser handles the speech, and some browsers send it to their own servers to do it.'
        }
      >
        {listening ? <StopIcon size={18} /> : <MicIcon size={18} />}
        {listening ? 'Stop' : 'Say it'}
      </button>

      {listening && (
        // aria-live, because the whole point is that they are not looking at
        // the screen while they talk.
        <p className="tiny muted dictate-heard" aria-live="polite">
          {heard || 'Listening…'}
        </p>
      )}
    </div>
  );
}
