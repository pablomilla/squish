/*
 * Prices, and in English the spelling, for the country this device's clock
 * is set to.
 *
 * The server shows prices for the country the browser's language names —
 * "en-US" is America — which is wrong for the many people in Britain whose
 * browser came set to American English. The time zone is a better guess:
 * almost nobody sets their clock to another country's time. So if it is one
 * of the six countries Squish sells in, and nobody picked a country from
 * the list under the plans, this shows that country's prices instead — and
 * if that country spells differently (America, or not), asks for the page
 * again as that country reads it.
 *
 * Everything it needs is on the page, written by the server in the page's
 * own language (the #prices-data block). The time zone is read here and
 * goes nowhere: no cookie, nothing stored, and the only request is the page
 * again, which says the country but not the time zone.
 */
(function () {
  var block = document.getElementById('prices-data');
  if (!block) return;
  var data;
  try {
    data = JSON.parse(block.textContent);
  } catch {
    return;
  }
  // A country picked from the list is a choice, not a guess.
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

  // A country that reads this page in other words — in English, American in
  // the US, British elsewhere — needs the page again, written that way. Once:
  // the page that comes back is for that country, so this stops there.
  if (data.words && data.words[region] !== data.words[data.region]) {
    var url = new URL(location.href);
    url.searchParams.set('country', region);
    url.searchParams.set('guess', '');
    location.replace(url.toString());
    return;
  }

  var prices = data.prices[region];
  var marked = document.querySelectorAll('[data-price]');
  for (var i = 0; i < marked.length; i++) {
    var name = marked[i].getAttribute('data-price');
    if (prices[name]) marked[i].textContent = prices[name];
  }
  var links = document.querySelectorAll('[data-country]');
  for (var j = 0; j < links.length; j++) {
    if (links[j].getAttribute('data-country') === region) links[j].setAttribute('aria-current', 'true');
    else links[j].removeAttribute('aria-current');
  }
})();
