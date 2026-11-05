// The site's own pages (guestbook.html, home.html, howtouse.html) have a few live links
// -- visitors' homepages, the Mail link, How To Use's link to the Translator API --
// marked `live-link`. dead-links.js marks them dead like any other link off the archive,
// and this takes the mark back off. The shell opens them
// (onArchiveClick in public/app/api.js). In the browser's full screen (a kiosk) they look
// the same but can't be clicked. Load it after dead-links.js, so its pass runs first; it
// runs again whenever full screen is entered or left.
(function () {
  var fullScreen = window.matchMedia('(display-mode: fullscreen)');
  function markLiveLinks() {
    var links = document.querySelectorAll('a.live-link');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.remove('dead');
      links[i].style.pointerEvents = fullScreen.matches ? 'none' : '';
      if (fullScreen.matches) links[i].setAttribute('aria-disabled', 'true');
      else links[i].removeAttribute('aria-disabled');
    }
  }
  document.addEventListener('DOMContentLoaded', markLiveLinks);
  fullScreen.addEventListener('change', markLiveLinks);
})();
