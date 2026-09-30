import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MicIcon, StopIcon } from './icons';
import { speechSupported, startDictation } from '../lib/speech';
import { currentRegion } from '../lib/region';
import { currentLanguage, speechLocale } from '../lib/language';
import './voice-field.css';
import { t } from '../lib/i18n';

interface Props {
  /** The text box itself: an `.input` or a `.textarea`. */
  children: ReactNode;
  /** What is in it now, shown ahead of the words still being heard. */
  value: string;
  /** Given the dictated words, to append or replace as the caller sees fit. */
  onText: (text: string) => void;
  onError?: (message: string) => void;
  /** What is being dictated, for the screen reader. */
  label?: string;
  /** A box of several lines: the microphone sits in its bottom corner rather than halfway down. */
  multiline?: boolean;
}

/**
 * A text box with a microphone in it, where every messaging app has taught
 * people to look for one.
 *
 * It used to be a "Say it" button under the box, which read as the next step:
 * with the keyboard up it was the last thing still showing, and people pressed
 * it to send.
 *
 * Press to start, press again to stop. Not a press-and-hold, which is the
 * obvious design and the wrong one — saying what you had for dinner takes
 * longer than a thumb wants to stay still, and the listing pauses that make
 * people lift their finger are exactly the pauses in the middle of a sentence.
 *
 * While it listens, the words appear in the box itself as they are heard, so
 * nothing below it moves. Where the browser has no speech recognition there
 * is no microphone and the box is an ordinary box.
 */
export default function VoiceField({ children, value, onText, onError, label = t('your meal'), multiline = false }: Props) {
  const [supported] = useState(speechSupported);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const session = useRef<{ stop(): void } | null>(null);
  const live = useRef<HTMLDivElement>(null);

  // A microphone that outlives the screen it was opened on is the kind of bug
  // people write app-store reviews about.
  useEffect(() => () => session.current?.stop(), []);

  // Keep the newest words in view as they arrive, in either direction of script.
  useLayoutEffect(() => {
    const box = live.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    box.scrollLeft = getComputedStyle(box).direction === 'rtl' ? -box.scrollWidth : box.scrollWidth;
  }, [heard, listening]);

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
    }, speechLocale(currentLanguage().id, currentRegion().id, currentRegion().locale));

    if (!started) {
      onError?.(t('Dictation would not start. Typing still works.'));
      return;
    }
    session.current = started;
    setListening(true);
  };

  const kept = value.trim();

  return (
    <div className={`voice${supported ? ' voice--mic' : ''}${multiline ? ' voice--box' : ''}`}>
      {children}

      {listening && (
        // aria-live, because the whole point is that they are not looking at
        // the screen while they talk.
        <div ref={live} className="voice-live" aria-live="polite">
          {kept && <span className="voice-kept">{kept} </span>}
          <span className="voice-heard">{heard || t('Listening…')}</span>
        </div>
      )}

      {supported && (
        <button
          type="button"
          className={`voice-mic${listening ? ' is-live' : ''}`}
          onClick={listening ? stop : start}
          aria-pressed={listening}
          aria-label={listening ? t('Stop dictating') : t('Dictate {what}', { what: label })}
          title={
            listening
              ? t('Stop dictating')
              : t('Say it instead of typing. Your browser handles the speech, and some browsers send it to their own servers to do it.')
          }
        >
          {listening ? <StopIcon size={16} /> : <MicIcon size={20} />}
        </button>
      )}
    </div>
  );
}
