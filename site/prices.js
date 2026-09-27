/*
 * Prices for the country this device's clock is set to.
 *
 * The server shows prices for the country the browser's language names —
 * "en-US" is America — which is wrong for the many people in Britain whose
 * browser came set to American English. guess.js, at the top of the page,
 * has already read the clock; where it found one of the six countries that
 * is not the one shown, and nobody picked one, it left it on
 * <html data-guess>. This swaps in that country's prices, which the server
 * put on the page (the #prices-data block) written in the page's language.
 * Nothing is asked of anybody.
 */
(function () {
  var region = document.documentElement.getAttribute('data-guess');
  var block = document.getElementById('prices-data');
  if (!region || !block) return;
  var data;
  try {
    data = JSON.parse(block.textContent);
  } catch {
    return;
  }
  var prices = data && data.prices && data.prices[region];
  if (!prices) return;

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
