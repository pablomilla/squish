/*
 * For anybody who used Squish at squish.online before it moved to
 * app.squish.online.
 *
 * A browser keeps what a site saves per address, so the diary they built here
 * is still in this browser, under this address — and this page, now at the
 * same address, can see it. Nothing is sent anywhere until they press the
 * button. Then:
 *
 *   1. The diary in this browser is saved to the server, as the app would
 *      have done on its own — registering this browser first, if it never
 *      had reason to before.
 *   2. The server gives this browser a one-time code for its device.
 *   3. They are sent to the app with that code after a # — the part of an
 *      address browsers never send to any server — and the app trades it for
 *      the same device, so their diary and account come with them.
 *
 * Plain script, no libraries, nothing loaded from anywhere else.
 */
(function () {
  var meta = document.querySelector('meta[name="squish-app"]');
  var APP = (meta && meta.getAttribute('content')) || 'https://app.squish.online';
  var box = document.getElementById('moved');
  if (!box) return;

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (e) {
      return null;
    }
  }

  var device = read('squish-device');
  var stored = read('squish-v1');
  var state = stored && stored.state;
  var profile = state && state.profile;
  if (!profile || !profile.onboarded) return;

  var title = box.querySelector('[data-title]');
  var text = box.querySelector('[data-text]');
  var button = box.querySelector('button');
  var name = typeof profile.name === 'string' && profile.name ? ', ' + profile.name : '';

  function settled() {
    title.textContent = 'Your diary now lives at the new address';
    text.textContent = 'Squish moved to app.squish.online, and your diary went with it. Bookmark it, or add it to your home screen again.';
    button.textContent = 'Open Squish';
    button.onclick = function () {
      location.href = APP;
    };
  }

  box.hidden = false;
  if (localStorage.getItem('squish-moved')) {
    settled();
    return;
  }

  title.textContent = 'Welcome back' + name;
  text.textContent =
    'Squish has moved to app.squish.online. Your diary is in this browser, and one tap takes it with you — meals, targets and all.';

  function auth() {
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + device.token };
  }

  /**
   * A browser that never got as far as talking to the server — no account,
   * and nothing it did ever needed one — has a diary but no device. It gets
   * one now, exactly as the app would have made it, so there is something to
   * move.
   */
  function ensureDevice() {
    if (device && device.token) return Promise.resolve();
    return fetch('/api/device', { method: 'POST' })
      .then(function (response) {
        if (!response.ok) throw new Error('no device');
        return response.json();
      })
      .then(function (made) {
        device = made;
        localStorage.setItem('squish-device', JSON.stringify(made));
      });
  }

  function lastSave() {
    // The same fields the app backs up, from the copy this browser holds.
    var keep = ['profile', 'targets', 'meals', 'days', 'favourites', 'unlocked', 'nutritionistNotes', 'look', 'theme'];
    var snapshot = {};
    keep.forEach(function (key) {
      if (key in state) snapshot[key] = state[key];
    });
    var version = Number(localStorage.getItem('squish-backup-version')) || null;
    // A refusal — somebody's other phone saved something newer — is fine: that
    // newer copy is the one that will arrive. Only a network failure matters,
    // and even then the last automatic backup is still there.
    return fetch('/api/diary', { method: 'PUT', headers: auth(), body: JSON.stringify({ state: snapshot, version: version }) }).catch(
      function () {},
    );
  }

  button.onclick = function () {
    button.disabled = true;
    button.textContent = 'Moving your diary…';
    ensureDevice()
      .then(lastSave)
      .then(function () {
        return fetch('/api/device/handoff', { method: 'POST', headers: auth() });
      })
      .then(function (response) {
        if (response.status === 401) {
          // Already moved, from another tab or an earlier visit.
          localStorage.setItem('squish-moved', '1');
          settled();
          button.disabled = false;
          return null;
        }
        if (!response.ok) throw new Error('not ok');
        return response.json();
      })
      .then(function (answer) {
        if (!answer || !answer.code) return;
        localStorage.setItem('squish-moved', '1');
        location.href = APP + '/#handoff=' + encodeURIComponent(answer.code);
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = 'Try again';
        text.textContent = 'That did not work — probably the connection. Your diary is still safe in this browser.';
      });
  };
})();
