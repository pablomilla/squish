/*
 * The country this device's clock is set to, guessed before anything is
 * drawn.
 *
 * Inlined by the server at the top of every page, straight after the data it
 * reads (the #prices-data block), so it runs while the page is still arriving.
 * That is the point: if the country reads the page in other words — in
 * English, American in the US and British elsewhere — the page is hidden and
 * asked for again at once, and the wrong spelling is never on screen. A
 * country picked from the list is a choice, not a guess, and is left alone.
 *
 * Otherwise it leaves its guess on <html data-guess>, for prices.js to swap
 * the prices once the page is there. The time zone goes nowhere: no cookie,
 * nothing stored, and the only request is the page again, which says the
 * country but not the time zone.
 */
(function () {
  var root = document.documentElement;
  var block = document.getElementById('prices-data');
  if (!block) return;
  var data;
  try {
    data = JSON.parse(block.textContent);
  } catch {
    return;
  }
  if (!data || data.picked) return;

  var zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return;
  }

  /** The same rule as regionFromTimeZone in src/lib/region.ts: an entry ending in "/" covers the zones under it. */
  var region = null;
  Object.keys(data.zones).forEach(function (id) {
    if (region) return;
    data.zones[id].forEach(function (entry) {
      var match = entry.charAt(entry.length - 1) === '/' ? zone.indexOf(entry) === 0 : zone === entry;
      if (match) region = id;
    });
  });
  if (!region || region === data.region || !data.prices[region]) return;

  if (data.words && data.words[region] !== data.words[data.region]) {
    // Hidden, so nothing of this version is painted while the right one comes.
    root.style.visibility = 'hidden';
    // Never left hidden: if the page is still here in a moment, show it as it is.
    setTimeout(function () {
      root.style.visibility = '';
    }, 3000);
    var url = new URL(location.href);
    url.searchParams.set('country', region);
    url.searchParams.set('guess', '');
    location.replace(url.toString());
    return;
  }
  root.setAttribute('data-guess', region);
})();
