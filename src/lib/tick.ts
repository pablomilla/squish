/**
 * The small click a dial makes as each value passes, like a phone's own
 * pickers, and a tap of vibration where the phone has one (Android; iPhones
 * do not let a web page vibrate).
 *
 * Made here rather than played from a file: a burst of noise a few
 * milliseconds long through a narrow filter, which is what a click is, and
 * nothing to download. Quiet, and never more than one every 30 ms, so a fast
 * flick is a purr rather than a racket.
 *
 * Browsers only allow sound after somebody has touched the page, so nothing
 * plays until `primeTicks` has run from a touch, a click or a key on a dial.
 * Where the browser can say so, the sound is "ambient": it respects the
 * silent switch and does not stop somebody's music.
 */
let audio: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let last = 0;

const GAP_MS = 30;

type WithAudioSession = Navigator & { audioSession?: { type: string } };

/** From a touch, click or key on a dial: sound may start now. */
export function primeTicks(): void {
  try {
    if (!audio) {
      const session = (navigator as WithAudioSession).audioSession;
      if (session) session.type = 'ambient';
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      audio = new Context();
      // 12 ms of white noise, made once.
      noise = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.012), audio.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

/** A value went by. */
export function tick(): void {
  const now = performance.now();
  if (now - last < GAP_MS) return;
  last = now;
  try {
    navigator.vibrate?.(4);
  } catch {
    /* not allowed here */
  }
  if (!audio || !noise || audio.state !== 'running') return;
  const at = audio.currentTime;
  const source = audio.createBufferSource();
  source.buffer = noise;
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 3200;
  band.Q.value = 1.4;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.35, at + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
  source.connect(band).connect(gain).connect(audio.destination);
  source.start(at);
  source.stop(at + 0.014);
}
