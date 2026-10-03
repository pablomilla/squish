/*
 * The Menu button on phones is a plain <details>, so it opens without this.
 * This only closes it again: after a link is followed (a link to a section of
 * the same page leaves the page where it is), on a tap outside it, or Escape.
 */
(function () {
  var menu = document.querySelector('.menu');
  if (!menu) return;
  var close = function () { menu.removeAttribute('open'); };
  menu.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('.menu-links a')) close();
  });
  document.addEventListener('click', function (event) {
    if (menu.open && !menu.contains(event.target)) close();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && menu.open) {
      close();
      menu.querySelector('summary').focus();
    }
  });
})();
