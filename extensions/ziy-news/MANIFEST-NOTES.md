/* Ziy News — the manifest, and why it looks like this.
 *
 * Manifest V3 on Gecko 156. Two engine facts drive this file, both verified
 * on this machine against the installed Firefox rather than assumed.
 *
 * 1. `background.service_worker` is NOT implemented (Firefox bug 1573659), so
 *    this is a `background.scripts` event page. The cross-browser recipe
 *    declares both and Gecko runs the scripts form. Every listener is
 *    registered synchronously at the top level, and every rebuild is
 *    idempotent, because an event page is suspended between calls.
 *
 * 2. The permission model for fetching arbitrary user-added RSS.
 *
 *    On Gecko, a background script can read a host it has host permissions
 *    for — MDN's Background scripts article states it plainly: "Background
 *    scripts can make XHR requests to hosts they have host permissions for."
 *    An extension PAGE cannot: page fetches are subject to CORS, so the panel
 *    and the options page cannot fetch a source's feed on their own, even for
 *    the user's own subscriptions.
 *
 *    The reference product ships its own catalog and CDN, so it never faces
 *    this question. We do: a source can be any URL the user pastes, so the
 *    fetch has to be cross-origin for an arbitrary origin. The engine's
 *    pragmatic answer is host_permissions <all_urls>, granted at install, so
 *    the event page can fetch any feed the user subscribes to without asking
 *    again per source. That is a wide grant, so:
 *      - it is documented in the options page in plain words (the "why"
 *        paragraph in ui/options.html and background/background.js),
 *      - the event page sends no cookies and no credentials with the fetch
 *        (credentials: "omit"), so the grant cannot be used to read an
 *        authenticated page on the user's behalf,
 *      - nothing fetched is sent anywhere: there is no telemetry, and the
 *        parsed items stay in this profile's IndexedDB.
 *
 * No other permission is asked for. Notably NOT requested: `tabs`,
 * `activeTab`, `scripting`, `webRequest`. This extension reads feeds and
 * opens links; it does not look at the user's browsing.
 *
 * NOTE: manifest.json itself MUST stay pure JSON. The engine's XPIInstall
 * parse is a bare JSON.parse with no comment tolerance, and a manifest with a
 * comment header is rejected silently and totally (proven by the shields
 * slice, see replica/proofs-shields.md §7.2). This comment lives here, in the
 * design notes, not in the file the engine reads.
 */
