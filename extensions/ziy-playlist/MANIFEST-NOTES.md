/* Ziy Playlist — the manifest, and why it looks like this.
 *
 * Manifest V3 on Gecko 156. Three engine facts drive this file, all verified
 * on this machine rather than assumed.
 *
 * 1. `background.service_worker` is NOT implemented (Firefox bug 1573659), so
 *    this is a `background.scripts` event page. Every lib file is loaded
 *    before the event page, because the libs merge into one shared global
 *    scope and the event page's top-level code runs immediately.
 *
 * 2. The permission model for playing another site's media.
 *
 *    On Gecko, an extension page CANNOT read another origin's media: page
 *    fetches are subject to CORS, and MDN's Background scripts article says
 *    it plainly — "Background scripts can make XHR requests to hosts they
 *    have host permissions for" — the grant belongs to the event page and to
 *    nobody else. For a media element in a moz-extension:// page, the same
 *    rule decides whether the bytes may arrive: the engine's cross-origin
 *    check for a subresource from an extension page consults the extension's
 *    host permission for that URL's origin (MDN, "host_permissions":
 *    "XMLHttpRequest and fetch access to those origins without cross-origin
 *    restrictions"). So the standard, documented pattern for an extension
 *    that plays media from arbitrary origins is host_permissions on those
 *    origins, which is exactly what ships here: `host_permissions:
 *    ["<all_urls>"]`, granted at install.
 *
 *    A `web_accessible_resources` entry does NOT solve this problem and is
 *    not used for playback. A WAR entry makes EXTENSION resources available
 *    to web pages; it does nothing for a web origin's media landing in an
 *    extension page.
 *
 *    `webRequest` + `webRequestBlocking` are here for the HLS loader's
 *    request plumbing, and `scripting` for the toolbar action's programmatic
 *    injection into pages the content script did not reach. `storage` and
 *    `tabs` are the queue and the address-bar equivalent.
 *
 * 3. The manifest itself MUST stay pure JSON. The engine's XPIInstall parse
 *    is a bare JSON.parse with no comment tolerance, and a manifest with a
 *    comment header is rejected silently and totally (proven by the shields
 *    slice, see replica/proofs-shields.md §7.2). This comment lives here, in
 *    the design notes, not in the file the engine reads.
 */
