import { t } from './i18n';
/**
 * Dictating a meal instead of typing it.
 *
 * This is the browser's own speech recognition, which is the only kind
 * available to a web app — there is no audio path to the model. That carries a
 * privacy consequence worth being straight about: on Chrome, recognition is
 * not done on the device. The audio goes to Google's servers and comes back as
 * text. Safari does it on-device where the phone is capable of it.
 *
 * Nothing about that is ours to fix from here, but it is ours to disclose, so
 * the button says so and the app's privacy policy will need to.
 *
 * Support is patchy — Chrome and Safari have it, Firefox has never shipped it
 * — so everything here is written to be absent rather than broken: `supported`
 * is false, the button does not appear, and typing carries on working.
 */

/** Only the parts we use. The DOM lib does not describe this API. */
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { readonly length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionConstructor = new () => Recognition;

function constructor(): RecognitionConstructor | null {
  const w = globalThis as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether dictation is worth offering at all. */
export function speechSupported(): boolean {
  return constructor() !== null;
}

export interface Dictation {
  /** Everything settled so far. */
  final: string;
  /** The words still being revised, shown greyed out as they arrive. */
  interim: string;
}

export interface DictationHandlers {
  onChange(state: Dictation): void;
  /** Called once when it stops, whether by hand, by silence, or by error. */
  onEnd(final: string): void;
  onError(message: string): void;
}

/** What went wrong, in words a person can act on. */
export function speechErrorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return t('Squish needs permission to use the microphone. You can allow it in your browser settings.');
  }
  if (code === 'no-speech') return t("I didn't catch anything — have another go.");
  if (code === 'audio-capture') return t('No microphone found.');
  if (code === 'network') return t('The speech service could not be reached.');
  return t('Dictation stopped unexpectedly. Typing still works.');
}

/** Whitespace and case are not differences worth noticing when comparing. */
const key = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Fold what the recogniser has said into one transcript.
 *
 * The naive version — join them all, or add the new ones to the old — is
 * wrong on both browsers, in opposite ways, and produces the same wreckage:
 *
 *   chicken chicken chicken and chicken and chicken and bacon chicken and
 *   bacon with chicken and bacon with mayonnaise …
 *
 * Safari, with `continuous` on, does not revise a result in place. It appends
 * each longer retelling of the same utterance to the list as its own *final*
 * result, so the list holds every snapshot on the way to the finished
 * sentence. Chrome revises in place but re-delivers earlier results, sometimes
 * with `resultIndex` rewound to zero, so anything that adds from there counts
 * them twice.
 *
 * What both have in common is that a segment which merely restates what is
 * already known should replace it rather than join it. So: a segment that
 * begins with everything so far is the same sentence, further along, and
 * supersedes it; a segment already contained at the end is a repeat and is
 * dropped; anything else is genuinely new and is joined on with a space —
 * Chrome pads its segments and Safari does not, which is how "chicken salad"
 * once met "and chips" as "saladand".
 *
 * The cost is that somebody who says "chicken" and then "chicken and chips"
 * gets the second only. That is almost certainly what they meant, and it is a
 * far better failure than the one above.
 */
export function mergeTranscript(segments: string[]): string {
  let text = '';
  for (const raw of segments) {
    const segment = raw.trim();
    if (!segment) continue;
    if (!text) {
      text = segment;
      continue;
    }
    const known = key(text);
    const heard = key(segment);
    if (heard.startsWith(known)) text = segment;
    else if (!known.endsWith(heard)) text = `${text} ${segment}`;
  }
  return text;
}

/**
 * A single dictation, already started. Returns null where the browser cannot
 * do it, so callers can treat "unsupported" and "declined" the same way.
 *
 * `continuous` is on deliberately: people pause in the middle of listing what
 * they ate, and a recogniser that stops at the first silence turns "chicken
 * salad…" into a complete sentence. It stops when the button is pressed again
 * or after the cap below, whichever comes first.
 */
export function startDictation(handlers: DictationHandlers, lang = 'en-GB'): { stop(): void } | null {
  const Ctor = constructor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let final = '';
  let done = false;

  // A microphone left open is a battery and a privacy problem, and a forgotten
  // one is easy: the button is small and the screen scrolls.
  const cap = setTimeout(() => stop(), 45_000);

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(cap);
    handlers.onEnd(final.trim());
  };

  recognition.onresult = (event) => {
    const finals: string[] = [];
    const moving: string[] = [];
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      (result.isFinal ? finals : moving).push(text);
    }
    final = mergeTranscript(finals);
    handlers.onChange({ final, interim: mergeTranscript(moving) });
  };

  recognition.onerror = (event) => {
    // Silence is not a failure worth a red message when something was said.
    if (event.error === 'no-speech' && final.trim()) return;
    if (event.error === 'aborted') return;
    handlers.onError(speechErrorMessage(event.error));
  };

  recognition.onend = finish;

  function stop(): void {
    try {
      recognition.stop();
    } catch {
      finish(); // Already stopped; make sure the caller still hears about it.
      return;
    }
    // `stop()` is supposed to end with an `onend`, and the button stays lit
    // until it does. Where it never arrives the microphone reads as live for
    // ever, so there is a second chance here rather than a stuck screen.
    setTimeout(finish, 1500);
  }

  try {
    recognition.start();
  } catch {
    clearTimeout(cap);
    return null;
  }

  return { stop };
}
