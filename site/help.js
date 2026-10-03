/*
 * The tour on /help: the app's own screens, one after another, beside the
 * step that explains each. It plays by itself once it is on screen, and
 * stops for good the moment somebody takes over — a step, Back, Next or
 * Pause — so it never moves on while they are reading. With reduced motion
 * asked for, it never plays by itself at all.
 *
 * All the words are in the page, where they are translated; this only moves
 * between them.
 */
(() => {
  const guide = document.querySelector('[data-guide]');
  if (!guide) return;
  const shots = [...guide.querySelectorAll('.guide-shot')];
  const steps = [...guide.querySelectorAll('.guide-step')];
  const taps = [...guide.querySelectorAll('.guide-tap')];
  const play = guide.querySelector('[data-guide-play]');
  const STEP_MS = 5500;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let at = 0;
  let timer = 0;
  let playing = false;

  const show = (index) => {
    at = (index + steps.length) % steps.length;
    shots.forEach((shot, n) => shot.classList.toggle('is-on', n === at));
    steps.forEach((step, n) => {
      step.classList.toggle('is-on', n === at);
      if (n === at) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    taps.forEach((tap) => tap.classList.toggle('is-on', Number(tap.dataset.tap) === at));
    // The bar under the step starts again from empty.
    const bar = steps[at].querySelector('.guide-bar');
    if (bar) {
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
    }
    // The next screen, fetched before it is needed.
    const next = shots[(at + 1) % shots.length];
    if (next) next.loading = 'eager';
  };

  const schedule = () => {
    window.clearTimeout(timer);
    if (playing && !document.hidden) timer = window.setTimeout(() => { show(at + 1); schedule(); }, STEP_MS);
  };

  const setPlaying = (on) => {
    playing = on;
    guide.classList.toggle('is-playing', on);
    play.setAttribute('aria-pressed', String(on));
    schedule();
  };

  const takeOver = (index) => {
    setPlaying(false);
    show(index);
  };

  steps.forEach((step, n) => step.addEventListener('click', () => takeOver(n)));
  guide.querySelector('[data-guide-prev]').addEventListener('click', () => takeOver(at - 1));
  guide.querySelector('[data-guide-next]').addEventListener('click', () => takeOver(at + 1));
  play.addEventListener('click', () => {
    if (!playing && at === steps.length - 1) show(0);
    setPlaying(!playing);
  });
  document.addEventListener('visibilitychange', schedule);

  if (!still && 'IntersectionObserver' in window) {
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      seen.disconnect();
      setPlaying(true);
    }, { threshold: 0.45 });
    seen.observe(guide);
  }
})();
