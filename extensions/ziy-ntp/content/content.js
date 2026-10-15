/* Ziy NTP — content scripts.
 *
 * The NTP is a `chrome_url_overrides.newtab` page, not a content script: its
 * whole surface is the page itself, and its pages already run with the
 * privileged `browser.*` APIs available (MDN, chrome_url_overrides). Nothing in
 * this module injects into other people's pages.
 *
 * This file exists so the module's shape matches the standard every Ziy
 * extension dir has (manifest.json, background/, ui/, content/, lib/, test/ —
 * architecture.md §8) and so the place for a future injection is obvious.
 *
 * If a future feature ever needs to touch a page, it goes here and it must be
 * declared in manifest.json `content_scripts` — not ad hoc.
 */
(function () {
  "use strict";
  /* Intentionally empty. See the note above. */
})();
