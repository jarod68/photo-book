/**
 * A real "back": the ← buttons at the top of the pages return to the page
 * the visitor came from — the search results, the map where it was, the
 * album and photo — like the browser's Back button; opened from outside (a
 * shared link, a bookmark, a new tab) they go to their own link (the home
 * page).
 *
 * Each page keeps what it needs to come back the way it was in its history
 * entry (history.state, via saveState): the browser keeps whole pages in its
 * back-forward cache most of the time, but not always (memory, Safari, a
 * reload), and then the page rebuilds itself from that state.
 */

/** True when the previous history entry is a page of this site we can go back to. */
export function cameFromApp() {
  if (history.length < 2 || !document.referrer) return false;
  try {
    const ref = new URL(document.referrer);
    // the login page sends a signed-in visitor on: never go back to it
    return ref.origin === location.origin && !/\/login(\.html)?$/.test(ref.pathname)
      && ref.href !== location.href;
  } catch { return false; }
}

/** Make a ← link go back in history when that leads to a page of the site. */
export function wireBack(el) {
  el?.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // new tab: the link
    if (!cameFromApp()) return;
    e.preventDefault();
    history.back();
  });
}

/** This page's saved state (from a previous visit of this history entry), or {}. */
export function pageState() {
  return (history.state && typeof history.state === 'object') ? history.state : {};
}

/** Merge `patch` into this history entry's state (and optionally change the URL, without a new entry). */
export function saveState(patch, url) {
  try {
    history.replaceState({ ...pageState(), ...patch }, '', url ?? location.href);
  } catch { /* state too big or blocked: the page just starts over */ }
}

/** Remember the scroll position when leaving the page… */
export function rememberScroll() {
  // ours, not the browser's: it would scroll before the content is loaded
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  addEventListener('pagehide', () => saveState({ scrollY: Math.round(scrollY) }));
}

/** …and put it back once the page's content is there (call after rendering). */
export function restoreScroll() {
  const y = pageState().scrollY;
  if (y > 0) requestAnimationFrame(() => scrollTo(0, y));
}
