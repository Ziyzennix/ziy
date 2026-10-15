/* Ziy NTP — configuration model.
 *
 * The single source of truth for the NTP's settings shape, defaults and merge
 * semantics. Used by the new tab page, the customize dashboard, the options
 * page, the background event page and the unit tests, so there is exactly one
 * definition of what an NTP config is.
 *
 * No DOM, no `browser.*` access, no I/O: this module is pure so the same code
 * runs in a page and under node --test. It is written UMD-style (a plain script
 * that also exports through `module`), which is why the page can load it with a
 * <script> tag and the tests can `require()` it.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ZiyNtpModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* -------------------------------------------------------------------------
   * Storage keys (architecture.md §3.1 `settings.*`).
   *
   * ntp.config      the NewTabPage entity: widget toggles, background, modes.
   * ntp.topsites.*  the TopSite[] entity, one list per mode.
   * ntp.engines     the user's per-engine on/off choice.
   *
   * Anything another Ziy module may read or write is namespaced with `ziy.`;
   * the shields blocked-total contract is `ziy.shields.blockedTotal`.
   * ---------------------------------------------------------------------- */

  const STORAGE_KEYS = Object.freeze({
    config: "ntp.config",
    topSites: "ntp.topsites",
    engines: "ntp.engines",
  });

  /* Cross-module contract. ziy-shields writes `ziy.shields.blockedTotal`; the
   * NTP stats widget reads it. The NTP never writes this key — it only reads, and
   * treats "absent" as "nothing has reported yet", which is a real zero count. */
  const SHIELDS_STORAGE_KEY = "ziy.shields.blockedTotal";

  /* Add-on id of ziy-shields, the same id the shell's policies.json and
   * shell/extensions.list use. */
  const SHIELDS_EXTENSION_ID = "ziy-shields@ziy.app";

  /* Add-on id of ziy-news. The NTP's news section reads its snapshot through
   * one message; nothing is shared, so the two extensions stay independent.
   * See replica/patches/ziy-ntp-news-integration.md. */
  const NEWS_EXTENSION_ID = "ziy-news@ziy.app";

  /* -------------------------------------------------------------------------
   * Bounds, from the recon (S05): 6 tiles per page, up to 24 curated tiles.
   * ---------------------------------------------------------------------- */

  const TILES_PER_PAGE = 6;
  const MAX_TOP_SITES = 24;

  /* -------------------------------------------------------------------------
   * Widgets. `id` is the storage/recon name; `label` is Ziy-voiced copy shown in
   * the dashboard and the options page.
   * ---------------------------------------------------------------------- */

  const WIDGETS = Object.freeze([
    Object.freeze({ id: "background", label: "Backdrop" }),
    Object.freeze({ id: "search", label: "Search" }),
    Object.freeze({ id: "topsites", label: "Top sites" }),
    Object.freeze({ id: "clock", label: "Clock" }),
    Object.freeze({ id: "stats", label: "Privacy stats" }),
    Object.freeze({ id: "news", label: "News" }),
  ]);

  /* The recon's NTP card widget (S51) is a separate switch because turning cards
   * off disables a *section* of the page rather than a single widget, and the
   * dashboard has to say so in its own copy. */
  const CARDS_WIDGET_ID = "cards";

  /* -------------------------------------------------------------------------
   * Search engines.
   *
   * Firefox exposes the browser's own engine list through browser.search.get()
   * (permission "search"). Where that is unavailable — a platform that does not
   * ship the API, or a permission the user has not granted — the NTP keeps its
   * own list so the widget never breaks. The "own provider" entry is a slot the
   * user fills in themselves in the options page; it ships off.
   * ---------------------------------------------------------------------- */

  const FALLBACK_ENGINES = Object.freeze([
    /* Google is the shipped default. It is listed here, in the engine picker,
       like every other entry the user can switch to, and the entry below is a
       plain direct-navigation URL — the same shape as the others, with the
       same {query} placeholder, no Ziy-hosted provider and no scored index of
       our own. Privacy-first Ziy does ship Google as the *default* because it
       is what people expect when they search, and every other engine is a
       radio click away, on the welcome page, in the NTP's switcher and in the
       options page. */
    Object.freeze({
      id: "google",
      name: "Google",
      urlTemplate: "https://www.google.com/search?q={query}",
      source: "fallback",
    }),
    Object.freeze({
      id: "duckduckgo-html",
      name: "DuckDuckGo",
      urlTemplate: "https://duckduckgo.com/html/?q={query}",
      source: "fallback",
    }),
    Object.freeze({
      id: "startpage",
      name: "Startpage",
      urlTemplate: "https://www.startpage.com/sp/search?query={query}",
      source: "fallback",
    }),
    Object.freeze({
      id: "searx-be",
      name: "SearXNG",
      urlTemplate: "https://searx.be/search?q={query}",
      source: "fallback",
    }),
    Object.freeze({
      id: "wikipedia",
      name: "Wikipedia",
      urlTemplate: "https://en.wikipedia.org/w/index.php?search={query}",
      source: "fallback",
    }),
    Object.freeze({
      id: "own-provider",
      name: "Your own provider",
      urlTemplate: "",
      source: "own",
      editable: true,
      /* The one slot that needs the user's own URL before it can work. */
      defaultOff: true,
    }),
  ]);

  /* What the NTP uses when the user has not picked anything: Google, as a
     direct navigation to its own results page. No Ziy-hosted provider exists
     and none is implied by this value — this is one engine among many in the
     picker, not a Ziy search index. Every other engine stays selectable, and
     an existing profile's saved `engineId` still wins over this default
     (mergeConfig keeps the stored id whenever it still resolves). */
  const DEFAULT_ENGINE_ID = "google";

  /* -------------------------------------------------------------------------
   * Backgrounds.
   *
   * Ziy ships no photo library: the recon records the reference's curated
   * background pipeline as `skip`, and the architecture ships our own tokens
   * instead. So the sources are a token-derived gradient, a solid token colour,
   * the user's own uploaded file, or off (the flat page background).
   * ---------------------------------------------------------------------- */

  const BACKGROUND_SOURCES = Object.freeze([
    Object.freeze({ id: "gradient", label: "Gradient" }),
    Object.freeze({ id: "solid", label: "Solid colour" }),
    Object.freeze({ id: "custom", label: "From your files" }),
    Object.freeze({ id: "off", label: "None" }),
  ]);

  /* Gradients are defined as token references so the shipped values stay
   * reviewable in one place and can never drift from tokens.css. Every stop is
   * a token custom property; nothing here hard-codes a hex. */
  const GRADIENTS = Object.freeze([
    Object.freeze({
      id: "gloam",
      label: "Gloam",
      css:
        "linear-gradient(160deg, var(--accent-bg) 0%, var(--bg) 62%, var(--surface-sunken) 100%)",
    }),
    Object.freeze({
      id: "dusk",
      label: "Dusk",
      css:
        "linear-gradient(200deg, var(--surface) 0%, var(--surface-sunken) 55%, var(--bg) 100%)",
    }),
    Object.freeze({
      id: "seal",
      label: "Seal",
      css:
        "radial-gradient(120% 90% at 18% 12%, var(--accent-bg) 0%, var(--bg) 58%, var(--surface-sunken) 100%)",
    }),
  ]);

  const SOLIDS = Object.freeze([
    Object.freeze({ id: "bg", label: "Page", token: "--bg" }),
    Object.freeze({ id: "surface", label: "Surface", token: "--surface" }),
    Object.freeze({ id: "sunken", label: "Sunken", token: "--surface-sunken" }),
    Object.freeze({ id: "accent-bg", label: "Gloam wash", token: "--accent-bg" }),
  ]);

  /* -------------------------------------------------------------------------
   * Defaults.
   *
   * Mirrors the `ziy.ntp.*` pref namespace the shell ships in
   * shell/browser/defaults/preferences/ziy.js: widgets on, clock 24-hour, stats
   * on. The pref layer is the shell's default; this object is what the extension
   * uses when storage has never been written, and the two must agree or a fresh
   * profile would show two different defaults.
   * ---------------------------------------------------------------------- */

  function defaultEngines() {
    return FALLBACK_ENGINES.map(function (engine) {
      return {
        id: engine.id,
        name: engine.name,
        urlTemplate: engine.urlTemplate,
        source: engine.source,
        editable: !!engine.editable,
        /* Carried through so mergeEngines, which decides the shipped on/off
           state, sees the same rule the fallback list applies. */
        defaultOff: !!engine.defaultOff,
        /* Every entry is available except the user's own slot, which has no
         * provider URL until they set one. */
        checked: engine.id !== "own-provider",
      };
    });
  }

  function defaultConfig() {
    return {
      widgets: {
        background: true,
        search: true,
        topsites: true,
        clock: true,
        stats: true,
        /* Off until the user asks for it: the section reads ziy-news's
           snapshot, and an empty news region on a fresh profile is noise. */
        news: false,
      },
      /* Off by default: Ziy ships no ad marketplace (the recon's out-of-scope
       * list), so there is nothing to fill the card region with yet, and a card
       * section advertising nothing is noise. The switch exists so the shell can
       * turn it on later without changing this shape. */
      cards: false,
      background: {
        source: "gradient",
        gradientId: "gloam",
        solidId: "bg",
        /* Data URL of the user's upload, or null. A data URL is stored rather
         * than a path so the backdrop survives a profile copy. */
        customDataUrl: null,
        customName: null,
        refreshOnNewTab: false,
      },
      /* recon S05: favorites is the curated default; frequent is computed. */
      topSitesMode: "favorites",
      /* 24-hour by default, matching the ziy.ntp.widgets.clock pref. */
      clock24h: true,
      /* null means "follow the browser's default search engine". */
      engineId: null,
    };
  }

  /* -------------------------------------------------------------------------
   * Merge.
   *
   * Merge is additive per section: an unknown key in the stored config is
   * dropped, a missing section is filled from defaults, and every scalar is
   * validated rather than trusted. That is what keeps "settings survive an
   * upgrade" and "settings never wedge on a partial write" true together.
   * ---------------------------------------------------------------------- */

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  /* Coerce to a boolean without accepting anything truthy: "off" and 0 must
   * become false, not pass through as true. */
  function toBool(value, fallback) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }

  function oneOf(value, allowed, fallback) {
    return allowed.indexOf(value) === -1 ? fallback : value;
  }

  function mergeBackground(stored, defaults) {
    /* Start from a copy of the defaults, never from the defaults object itself:
       that object is produced fresh by defaultConfig() each time and the
       normalisation below mutates its fields. */
    const out = Object.assign({}, defaults);
    /* Only the known keys are copied: an unknown key in the stored section is
       dropped so a later rename can never leak the old shape through, and so
       nothing unexpected reaches the renderer. */
    const whitelist = [
      "source",
      "gradientId",
      "solidId",
      "customDataUrl",
      "customName",
      "refreshOnNewTab",
    ];
    const input = isPlainObject(stored) ? stored : {};
    const base = {};
    for (const key of whitelist) {
      if (Object.prototype.hasOwnProperty.call(input, key)) base[key] = input[key];
    }
    Object.assign(out, base);
    out.source = oneOf(out.source, ["gradient", "solid", "custom", "off"], defaults.source);
    out.gradientId = oneOf(
      out.gradientId,
      GRADIENTS.map(function (g) { return g.id; }),
      defaults.gradientId,
    );
    out.solidId = oneOf(
      out.solidId,
      SOLIDS.map(function (s) { return s.id; }),
      defaults.solidId,
    );
    /* The upload is the only value that may be a large data URL. If it is not a
     * string, or the source is no longer "custom", it is dropped rather than
     * kept, so a stale upload cannot outlive the choice that made it. */
    if (
      out.source !== "custom" ||
      typeof out.customDataUrl !== "string" ||
      !out.customDataUrl
    ) {
      out.customDataUrl = null;
      out.customName = null;
    } else if (typeof out.customName !== "string" || !out.customName) {
      out.customName = null;
    }
    out.refreshOnNewTab = toBool(out.refreshOnNewTab, defaults.refreshOnNewTab);
    return out;
  }

  function engineExists(id) {
    /* A browser-provided engine carries an id of the form `browser:<name>`,
       which is generated at runtime and cannot be known here. Those ids are
       accepted as-is; only ids that are neither a fallback entry nor a
       browser-provenance id are dropped. */
    if (id.startsWith("browser:")) return id.length > "browser:".length;
    return FALLBACK_ENGINES.some(function (e) { return e.id === id; });
  }

  function mergeConfig(stored) {
    const defaults = defaultConfig();
    if (!isPlainObject(stored)) return defaults;
    const out = defaultConfig();

    const widgets = isPlainObject(stored.widgets) ? stored.widgets : {};
    for (const widget of WIDGETS) {
      out.widgets[widget.id] = toBool(widgets[widget.id], defaults.widgets[widget.id]);
    }

    out.cards = toBool(stored.cards, defaults.cards);
    out.background = mergeBackground(stored.background, defaults.background);
    out.topSitesMode = oneOf(
      stored.topSitesMode,
      ["favorites", "frequent"],
      defaults.topSitesMode,
    );
    out.clock24h = toBool(stored.clock24h, defaults.clock24h);
    /* An engine id is only kept if it still resolves; a removed engine falls
     * back to "follow the browser default" rather than stranding the widget. */
    if (typeof stored.engineId === "string" && stored.engineId) {
      out.engineId = engineExists(stored.engineId) ? stored.engineId : null;
    }
    return out;
  }

  /* -------------------------------------------------------------------------
   * URL validation for the Add/Edit site dialog (recon F09).
   *
   * The recon's rule is "must have a scheme". We enforce that plus a hostname,
   * because a bare `example.com` is ambiguous when the NTP is itself an
   * extension page: it would resolve against the moz-extension origin instead
   * of the web. Anything else is rejected with a message that says why.
   * ---------------------------------------------------------------------- */

  function validateSiteUrl(input) {
    if (typeof input !== "string" || !input.trim()) {
      return { ok: false, error: "Give the site's full web address." };
    }
    const trimmed = input.trim();
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch (_err) {
      return { ok: false, error: "Use a full address with a scheme, like https://example.com." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        ok: false,
        error: "Only http and https addresses can be added as top sites.",
      };
    }
    if (!parsed.hostname || parsed.hostname.indexOf(".") === -1) {
      return {
        ok: false,
        error: "That address needs a host name, like https://example.com.",
      };
    }
    return { ok: true, url: parsed.href, host: parsed.hostname };
  }

  /* -------------------------------------------------------------------------
   * The top-sites storage model (recon S05 / F09).
   *
   * Shape: an array of `{ id, url, title, position, mode }`, sorted by position,
   * where position is a dense 0..n-1 integer. One list per mode; the two modes
   * are independent by construction — they are stored under different keys —
   * which is the behaviour the recon calls out for F09.
   * ---------------------------------------------------------------------- */

  const TOP_SITE_MODES = Object.freeze(["favorites", "frequent"]);

  function safeHref(url) {
    try {
      return new URL(url).href;
    } catch (_err) {
      return String(url);
    }
  }

  /* Normalise an arbitrary stored array into a valid, gap-free, position-sorted
   * list. This is the one place "what is a TopSite" is decided, so a malformed
   * record can never reach the renderer. */
  function normaliseTopSites(input, mode) {
    const siteMode = mode === "frequent" ? "frequent" : "favorites";
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of input) {
      if (!isPlainObject(raw)) continue;
      if (typeof raw.id !== "string" || !raw.id || seen.has(raw.id)) continue;
      let host;
      try {
        const parsed = new URL(raw.url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
        host = parsed.hostname;
      } catch (_err) {
        continue;
      }
      seen.add(raw.id);
      out.push({
        id: raw.id,
        url: safeHref(raw.url),
        title:
          typeof raw.title === "string" && raw.title.trim()
            ? raw.title.trim().slice(0, 200)
            : host,
        position: 0,
        mode: siteMode,
      });
    }
    /* Stored order is respected; positions are renumbered dense afterwards. */
    return renumber(out);
  }

  /* Renumber positions to 0..n-1 in array order, returning a new array. */
  function renumber(sites) {
    return sites.map(function (site, index) {
      return Object.assign({}, site, { position: index });
    });
  }

  function findIndexById(list, id) {
    return list.findIndex(function (s) { return s.id === id; });
  }

  /* Add. Returns a new list; never mutates the input. */
  function addTopSite(list, site) {
    const current = normaliseTopSites(list, "favorites");
    if (current.length >= MAX_TOP_SITES) {
      return {
        ok: false,
        error: "Ziy keeps up to " + MAX_TOP_SITES + " top sites. Remove one first.",
        sites: current,
      };
    }
    const check = validateSiteUrl(site && site.url);
    if (!check.ok) return { ok: false, error: check.error, sites: current };
    if (current.some(function (s) { return s.url === check.url; })) {
      return { ok: false, error: "That site is already in your list.", sites: current };
    }
    const entry = {
      id: (site && site.id) || newId(),
      url: check.url,
      title: (site && site.title && String(site.title).trim()) || check.host,
      position: current.length,
      mode: "favorites",
    };
    return { ok: true, sites: current.concat([entry]) };
  }

  /* Edit in place, keeping the position. */
  function editTopSite(list, id, patch) {
    const current = normaliseTopSites(list, "favorites");
    const index = findIndexById(current, id);
    if (index === -1) {
      return { ok: false, error: "That site is no longer in your list.", sites: current };
    }
    let url = current[index].url;
    if (patch && Object.prototype.hasOwnProperty.call(patch, "url")) {
      const check = validateSiteUrl(patch.url);
      if (!check.ok) return { ok: false, error: check.error, sites: current };
      url = check.url;
    }
    if (current.some(function (s) { return s.url === url && s.id !== id; })) {
      return { ok: false, error: "That site is already in your list.", sites: current };
    }
    const merged = Object.assign({}, current[index], patch || {});
    merged.url = url;
    merged.id = id;
    merged.position = current[index].position;
    merged.mode = "favorites";
    merged.title =
      patch && typeof patch.title === "string" && patch.title.trim()
        ? patch.title.trim().slice(0, 200)
        : current[index].title;
    const next = current.slice();
    next[index] = merged;
    return { ok: true, sites: renumber(next) };
  }

  /* Remove. Positions renumber so the list stays dense. */
  function removeTopSite(list, id) {
    const current = normaliseTopSites(list, "favorites");
    return { ok: true, sites: renumber(current.filter(function (s) { return s.id !== id; })) };
  }

  /* Move by `delta`, clamped to the list. Positive delta moves it later. */
  function moveTopSite(list, id, delta) {
    const current = normaliseTopSites(list, "favorites");
    const index = findIndexById(current, id);
    if (index === -1) {
      return { ok: false, error: "That site is no longer in your list.", sites: current };
    }
    const target = index + delta;
    if (target < 0 || target >= current.length) {
      return { ok: false, error: "That site is already at the end of the list.", sites: current };
    }
    const next = current.slice();
    const moved = next.splice(index, 1)[0];
    next.splice(target, 0, moved);
    return { ok: true, sites: renumber(next) };
  }

  /* Reorder by an explicit id sequence, as a pointer drag produces. Ids not in
   * the list are dropped; ids missing from the order keep their relative order
   * at the end. Idempotent. */
  function reorderTopSites(list, order) {
    const current = normaliseTopSites(list, "favorites");
    const byId = new Map(current.map(function (s) { return [s.id, s]; }));
    const wanted = Array.isArray(order) ? order.slice() : [];
    const picked = [];
    const taken = new Set();
    for (const id of wanted) {
      if (!byId.has(id) || taken.has(id)) continue;
      picked.push(byId.get(id));
      taken.add(id);
    }
    for (const site of current) {
      if (!taken.has(site.id)) picked.push(site);
    }
    return { ok: true, sites: renumber(picked) };
  }

  /* Page slice for the grid: 6 tiles per page (recon S05). Always returns a
   * valid page number even when `page` is out of range. */
  function pageOf(list, page) {
    const current = normaliseTopSites(list, "favorites");
    const pages = Math.max(1, Math.ceil(current.length / TILES_PER_PAGE));
    const index = Math.min(Math.max(0, page), pages - 1);
    return {
      sites: current.slice(index * TILES_PER_PAGE, index * TILES_PER_PAGE + TILES_PER_PAGE),
      page: index,
      pages: pages,
    };
  }

  /* -------------------------------------------------------------------------
   * Engines.
   *
   * `mergeEngines` reconciles the persisted choice list with the engine list
   * that is actually available right now (browser.search.get() when it works,
   * the fallback list when it does not). The invariant: every available engine
   * appears exactly once, in the order given, keeps its stored on/off state when
   * it has one, and defaults to on.
   * ---------------------------------------------------------------------- */

  function mergeEngines(available, stored) {
    const list = Array.isArray(available) && available.length ? available : FALLBACK_ENGINES;
    const saved = new Map();
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (entry && typeof entry.id === "string") saved.set(entry.id, entry.checked !== false);
      }
    }
    const out = [];
    const seen = new Set();
    for (const engine of list) {
      const id = engine.id || engine.name;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id: id,
        name: engine.name || id,
        /* A browser-provided engine has no URL template of its own: the NTP hands
         * it to browser.search.search() by name. A fallback entry navigates to
         * its template. */
        urlTemplate: engine.urlTemplate || null,
        source: engine.source || (engine.urlTemplate ? "fallback" : "browser"),
        editable: !!engine.editable,
        /* Carried through so the widget can follow the browser's own default
           rather than guessing. */
        isDefault: !!engine.isDefault,
        /* A slot the user has to configure themselves (the own-provider entry)
         * ships off and stays off until they give it a URL; everything else is
         * on unless the user turned it off. `defaultOff` is honoured whether it
         * came from the fallback list or from a caller's own list. */
        checked: engine.defaultOff
          ? saved.has(id)
            ? saved.get(id)
            : false
          : saved.has(id)
            ? saved.get(id)
            : true,
      });
    }
    return out;
  }

  /* Build the URL a search should navigate to. Returns null when the engine can
   * only be used through browser.search.search() — a browser-provided engine
   * with no template. */
  function buildSearchUrl(engine, query) {
    if (!engine || typeof engine.urlTemplate !== "string" || !engine.urlTemplate) return null;
    const q = String(query == null ? "" : query).trim();
    if (!q) return null;
    const encoded = encodeURIComponent(q).replace(/%20/g, "+");
    return engine.urlTemplate.split("{query}").join(encoded);
  }

  /* Normalise a stored choice list into the flat {id, checked} shape the options
   * page edits. Ids are de-duplicated. */
  function normaliseEngineChoices(stored) {
    if (!Array.isArray(stored)) return [];
    const out = [];
    const seen = new Set();
    for (const entry of stored) {
      if (!isPlainObject(entry) || typeof entry.id !== "string" || !entry.id) continue;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push({ id: entry.id, checked: entry.checked !== false });
    }
    return out;
  }

  /* -------------------------------------------------------------------------
   * Clock formatting. Pure, so the 12/24h behaviour is unit-testable with no
   * DOM and no real timer.
   * ---------------------------------------------------------------------- */

  function formatClock(date, use24h) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return { time: "", date: "", seconds: "" };
    const hours24 = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    let hours;
    let suffix = "";
    if (use24h) {
      hours = String(hours24).padStart(2, "0");
    } else {
      const h12 = hours24 % 12;
      hours = String(h12 === 0 ? 12 : h12);
      suffix = hours24 < 12 ? " AM" : " PM";
    }
    /* toLocaleDateString is the only locale-aware call here and it is behind a
     * try, because a platform with a trimmed ICU must not break the clock. */
    let dateText;
    try {
      dateText = d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    } catch (_err) {
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const months = [
        "January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December",
      ];
      dateText = days[d.getDay()] + ", " + months[d.getMonth()] + " " + d.getDate();
    }
    return { time: hours + ":" + minutes + suffix, date: dateText, seconds: seconds };
  }

  /* -------------------------------------------------------------------------
   * Stats copy. The three cards the recon's NTP stats widget has, phrased in
   * Ziy's own words, with a number formatter that never throws.
   * ---------------------------------------------------------------------- */

  function formatCount(n) {
    const value = typeof n === "number" && isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    try {
      return value.toLocaleString();
    } catch (_err) {
      return String(value);
    }
  }

  /* Bytes are an estimate derived from the blocked count, because the shield
   * layer owns the real figure. The estimate is labelled as an estimate in the
   * UI rather than presented as a measurement. */
  function formatBytes(bytes) {
    const value = typeof bytes === "number" && isFinite(bytes) ? Math.max(0, bytes) : 0;
    const units = ["B", "KB", "MB", "GB", "TB"];
    if (value < 1) return "0 " + units[1];
    let index = 0;
    let size = value;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    /* Bytes themselves are never shown with a fraction; larger units get one
       decimal below 10 so 1.5 MB reads as 1.5 rather than 2. */
    const rounded =
      index === 0 || size >= 10 ? Math.round(size) : Math.round(size * 10) / 10;
    return rounded + " " + units[index];
  }

  /* -------------------------------------------------------------------------
   * id generation: crypto.randomUUID where the platform has it (it does in an
   * extension page and in node ≥ 19), with a fallback so a trimmed build still
   * produces valid ids.
   * ---------------------------------------------------------------------- */

  function newId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return "ts-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /* ---------------------------------------------------------------------- */

  return {
    /* keys and contracts */
    STORAGE_KEYS,
    SHIELDS_STORAGE_KEY,
    SHIELDS_EXTENSION_ID,
    NEWS_EXTENSION_ID,
    /* bounds */
    TILES_PER_PAGE,
    MAX_TOP_SITES,
    /* vocabularies */
    WIDGETS,
    CARDS_WIDGET_ID,
    TOP_SITE_MODES,
    FALLBACK_ENGINES,
    DEFAULT_ENGINE_ID,
    BACKGROUND_SOURCES,
    GRADIENTS,
    SOLIDS,
    /* defaults + merge */
    defaultConfig,
    defaultEngines,
    mergeConfig,
    /* validation */
    validateSiteUrl,
    /* top sites */
    normaliseTopSites,
    addTopSite,
    editTopSite,
    removeTopSite,
    moveTopSite,
    reorderTopSites,
    pageOf,
    /* engines */
    engineExists,
    mergeEngines,
    buildSearchUrl,
    normaliseEngineChoices,
    /* presentation helpers */
    formatClock,
    formatCount,
    formatBytes,
    /* ids */
    newId,
  };
});
