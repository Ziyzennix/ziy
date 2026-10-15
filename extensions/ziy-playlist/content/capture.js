/* Ziy Playlist — the content script that finds media on a page.
 *
 * WHAT THIS IS FOR
 * The reference puts its prompt in the address bar, which is browser chrome
 * and therefore not ours to own on Gecko: our address bar is the engine's.
 * The equivalent affordance is this one, and it is honest about being the
 * equivalent:
 *
 *   - a small prompt near the media element that appears while the page is
 *     actually playing something,
 *   - plus the toolbar Action, which stays the always-available entry point
 *     ("Add this page's media") for pages where the prompt is dismissed or
 *     the media is not the first thing on screen.
 *
 * The prompt is DISMISSED PER SITE, and the dismissal is the user's own
 * choice, recorded by the event page. It is never a reminder that comes back.
 *
 * WHAT IS EXPOSED, AND HOW
 * Everything the queue needs about a media element is gathered here — the
 * playable sources, the page's own metadata (og:title, og:image,
 * schema.org, document.title), duration and poster — and sent to the event
 * page over runtime.sendMessage. There is no message port: the panel is the
 * player, so a live channel to the page has no consumer, and a port that
 * stays open per tab is background activity for nothing (replica/fixes.md
 * §1.2's CPU complaints are exactly this class of waste).
 *
 * NO NETWORK, NO POLLING. This script listens to media events, and those
 * events are how it knows a page is playing. Nothing is on a timer.
 */
(function () {
  "use strict";

  const model = globalThis.ZiyPlaylistModel;
  const classify = globalThis.ZiyPlaylistClassify;

  const api = typeof browser !== "undefined" ? browser : chrome;

  const EXTENSION = "ziy-playlist@ziy.app";

  /* The prompt's own copy, in Ziy's voice. */
  const COPY = Object.freeze({
    add: "Add to playlist",
    adding: "Adding…",
    added: "Added to your playlist",
    already: "Already in your playlist",
    dismiss: "Don't ask on this site",
    title: "Ziy Playlist",
  });

  const PROMPT_ID = "ziy-playlist-prompt";
  const PENDING_KEY = "__ziyPlaylistMedia";

  /* ------------------------------------------------------------------ *
   * Page metadata. Read once per document: og:, schema.org, <title>.
   * ------------------------------------------------------------------ */

  function readPage() {
    const title = document.title ? document.title.trim() : "";
    let ogTitle = "";
    let ogImage = "";
    let schemaTitle = "";
    let schemaImages = [];
    let schemaDuration = 0;

    const ogTitleEl = document.querySelector('meta[property="og:title"], meta[name="og:title"]');
    if (ogTitleEl) ogTitle = (ogTitleEl.getAttribute("content") || "").trim();
    const ogImageEl = document.querySelector('meta[property="og:image"], meta[name="og:image"]');
    if (ogImageEl) ogImage = (ogImageEl.getAttribute("content") || "").trim();

    /* schema.org JSON-LD: the richest source a video page has, and the one
       the reference's own metadata extraction leans on. Read defensively —
       a page's JSON-LD is arbitrary JS-shaped data, never trusted. */
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data = null;
      try {
        data = JSON.parse(script.textContent || "");
      } catch (_e) {
        continue;
      }
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const graph = Array.isArray(node["@graph"]) ? node["@graph"] : [node];
        for (const entry of graph) {
          if (!entry || typeof entry !== "object") continue;
          const type = String(entry["@type"] || "").toLowerCase();
          if (/(videoobject|movie|episode|mediaobject|audioobject)/.test(type)) {
            if (!schemaTitle && typeof entry.name === "string") schemaTitle = entry.name.trim();
            const images = entry.thumbnailUrl || entry.image;
            const list = Array.isArray(images) ? images : images ? [images] : [];
            for (const image of list) {
              const value = typeof image === "string" ? image : image && image.url;
              if (typeof value === "string" && value !== "") schemaImages.push(value.trim());
            }
            const dur = entry.duration;
            if (typeof dur === "string" && !schemaDuration) {
              schemaDuration = parseIsoDuration(dur);
            }
          }
        }
      }
    }

    let host = "";
    try {
      host = location.hostname.toLowerCase();
    } catch (_e) {
      host = "";
    }

    return {
      title: title,
      url: location.href,
      host: host,
      origin: location.origin,
      ogTitle: ogTitle,
      ogImage: ogImage,
      schemaTitle: schemaTitle,
      schemaImages: schemaImages.slice(0, 4),
      schemaDuration: schemaDuration,
    };
  }

  /** ISO-8601 duration (PT1H2M3S) to seconds. 0 when unparseable. */
  function parseIsoDuration(text) {
    const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(String(text || "").trim());
    if (!match) return 0;
    const days = Number(match[1] || 0);
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    const seconds = Number(match[4] || 0);
    return Math.round(days * 86400 + hours * 3600 + minutes * 60 + seconds);
  }

  /* ------------------------------------------------------------------ *
   * Reading an element's sources.
   * ------------------------------------------------------------------ */

  function elementInfo(el) {
    const sources = [];
    for (const child of el.querySelectorAll("source")) {
      sources.push({ src: child.getAttribute("src") || child.src || "", type: child.getAttribute("type") || "" });
    }
    let duration = Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : 0;
    if (!duration) duration = pageCache.duration = pageCache.duration || 0;
    return {
      src: el.currentSrc || el.src || "",
      currentSrc: el.currentSrc || "",
      currentType: el.currentType || el.getAttribute("type") || "",
      type: el.getAttribute("type") || "",
      sources: sources,
      title: el.getAttribute("title") || el.getAttribute("aria-label") || "",
      poster: el.getAttribute("poster") || "",
      duration: duration,
    };
  }

  /** The page-level duration hint, from schema.org or a loaded media element. */
  let pageCache = readPageMetaPlaceholder();
  function readPageMetaPlaceholder() {
    return { duration: 0, meta: null };
  }

  /* ------------------------------------------------------------------ *
   * The prompt.
   *
   * One element, injected into the page, positioned near the media it
   * belongs to. It is a real <button> inside a <div role="status">, so it is
   * reachable by keyboard, announced by a screen reader, and dismissable
   * with Esc. It carries Ziy's own skin (a tokens-only stylesheet string),
   * because a prompt that looked like the page's own markup would be a
   * spoofing surface.
   * ------------------------------------------------------------------ */

  const PROMPT_STYLE = [
    "position:absolute",
    "z-index:2147483647",
    "display:flex",
    "gap:6px",
    "align-items:center",
    "padding:6px 8px",
    "border-radius:10px",
    "background:rgba(23,24,26,.94)",
    "color:#f4f5f6",
    "font:500 12px/16px Inter,system-ui,sans-serif",
    "box-shadow:0 12px 32px rgba(0,0,0,.7)",
    "border:1px solid rgba(244,245,246,.24)",
    "max-width:min(92vw,360px)",
  ].join(";");

  const BUTTON_STYLE = [
    "appearance:none",
    "border:1px solid rgba(244,245,246,.32)",
    "background:transparent",
    "color:#f4f5f6",
    "border-radius:999px",
    "padding:4px 10px",
    "font:inherit",
    "cursor:pointer",
  ].join(";");

  function ensurePrompt() {
    let prompt = document.getElementById(PROMPT_ID);
    if (prompt) return prompt;
    const host = document.createElement("div");
    host.id = PROMPT_ID;
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.setAttribute("data-ziy", "playlist-prompt");
    host.setAttribute("style", PROMPT_STYLE);
    host.hidden = true;

    const label = document.createElement("span");
    label.textContent = COPY.add;
    label.setAttribute("data-role", "label");

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = COPY.add;
    button.setAttribute("aria-label", COPY.add);
    button.setAttribute("style", BUTTON_STYLE);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      void addCurrentElement();
    });

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "✕";
    dismiss.setAttribute("aria-label", COPY.dismiss);
    dismiss.setAttribute("style", BUTTON_STYLE);
    dismiss.addEventListener("click", (event) => {
      event.preventDefault();
      dismissSite();
    });

    host.append(label, button, dismiss);
    document.documentElement.appendChild(host);
    return host;
  }

  function showPrompt(el) {
    const prompt = ensurePrompt();
    prompt.dataset.forElement = String(mediaIndexOf(el));
    const rect = el.getBoundingClientRect();
    const top = Math.max(8, rect.top + window.scrollY + 8);
    const left = Math.max(8, rect.left + window.scrollX + 8);
    prompt.style.top = `${Math.round(top)}px`;
    prompt.style.left = `${Math.round(left)}px`;
    prompt.hidden = false;
  }

  function hidePrompt() {
    const prompt = document.getElementById(PROMPT_ID);
    if (prompt) prompt.hidden = true;
  }

  /* ------------------------------------------------------------------ *
   * The element registry.
   *
   * A page can hold several media elements (an inline clip plus a player).
   * They are tracked in a WeakMap-free list, because the prompt needs to
   * show the one that is PLAYING, and that can change.
   * ------------------------------------------------------------------ */
  const registry = [];
  let activeIndex = -1;

  function mediaIndexOf(el) {
    const at = registry.indexOf(el);
    return at >= 0 ? at : registry.push(el) - 1;
  }

  function activeElement() {
    return activeIndex >= 0 ? registry[activeIndex] : null;
  }

  function refreshActiveFromEvent(el) {
    const at = mediaIndexOf(el);
    activeIndex = at;
    const info = elementInfo(el);
    pageCache.duration = info.duration || pageCache.duration;
    if (settingsCache.autoAdd && !siteCache.dismissed && classify.itemFromElement(info, pageCache.meta || readPage())) {
      showPrompt(el);
    } else {
      hidePrompt();
    }
  }

  /* The startup state: settings and the per-site dismissal, fetched once per
     document. Two small messages, then nothing until the user acts. */
  let settingsCache = { autoAdd: true };
  let siteCache = { dismissed: false };

  function bootstrap() {
    pageCache.meta = readPage();
    void api.runtime.sendMessage(EXTENSION, {
      op: "playlist.page.hello",
      from: "content",
      origin: pageCache.meta.origin,
    }).then((reply) => {
      if (!reply || reply.ok !== true) return;
      if (reply.settings) settingsCache = reply.settings;
      if (reply.site && reply.site.dismissed === true) siteCache.dismissed = true;
    }).catch(() => { /* no event page right now: the toolbar action still works */ });
  }

  /* ------------------------------------------------------------------ *
   * The add path.
   * ------------------------------------------------------------------ */

  async function addCurrentElement() {
    const el = activeElement();
    if (!el) return false;
    const info = elementInfo(el);
    const page = pageCache.meta || readPage();
    const item = classify.itemFromElement(info, page);
    if (!item) {
      setPromptLabel("This page's media is not something the player can take.");
      return false;
    }
    setPromptLabel(COPY.adding);
    try {
      const reply = await api.runtime.sendMessage(EXTENSION, {
        op: "playlist.add",
        from: "content",
        item: item,
      });
      if (reply && reply.ok === true) {
        setPromptLabel(reply.added ? COPY.already : COPY.added);
        announceToPage(COPY.added);
        hidePromptSoon();
        return true;
      }
      setPromptLabel("That media could not be added.");
      return false;
    } catch (err) {
      setPromptLabel("That media could not be added.");
      return false;
    }
  }

  function setPromptLabel(text) {
    const prompt = document.getElementById(PROMPT_ID);
    if (!prompt) return;
    const label = prompt.querySelector('[data-role="label"]');
    if (label) label.textContent = text;
  }

  let hideTimer = 0;
  function hidePromptSoon() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hidePrompt, 2500);
  }

  /* A page-context event, so a page that wants to know can see it — this is
     the documented way to hand a fact to the page without granting it any
     access to the extension. */
  function announceToPage(text) {
    try {
      window.dispatchEvent(new CustomEvent("ziy-playlist:added", { detail: { message: text } }));
    } catch (_e) { /* a page with a locked-down window does not get the event */ }
  }

  async function dismissSite() {
    hidePrompt();
    siteCache.dismissed = true;
    try {
      await api.runtime.sendMessage(EXTENSION, {
        op: "playlist.site.dismiss",
        from: "content",
        origin: pageCache.meta ? pageCache.meta.origin : location.origin,
      });
    } catch (_e) { /* the dismissal is local either way until it is stored */ }
  }

  /* ------------------------------------------------------------------ *
   * The page-context bridge.
   *
   * The panel URL is published on the page for the same reason ziy-talk does
   * it: the engine does not expose a moz-extension:// UUID anywhere a harness
   * can read it, and the only place it exists is the extension's own origin.
   * A content script's `window` is a sandbox wrapper, so the property has to
   * be cloned into the page's own global to be visible to a page-context
   * Runtime.evaluate. cloneInto is the documented way to do that.
   * ------------------------------------------------------------------ */
  function publishPanelUrl() {
    let url = "";
    try {
      url = api.runtime.getURL("/ui/panel.html");
    } catch (_e) {
      return;
    }
    try {
      if (typeof cloneInto === "function") {
        cloneInto(url, window, { defineAs: "__ziyPlaylistPanelURL" });
      } else {
        window.__ziyPlaylistPanelURL = url;
      }
    } catch (_e) { /* a page that forbids it just does not publish it */ }
  }

  /* ------------------------------------------------------------------ *
   * Wiring: media events only. No timers, no observers on DOM mutation
   * beyond the media elements themselves, no intervals.
   * ------------------------------------------------------------------ */

  for (const el of document.querySelectorAll("video, audio")) {
    mediaIndexOf(el);
    el.addEventListener("play", () => refreshActiveFromEvent(el));
    el.addEventListener("playing", () => refreshActiveFromEvent(el));
    el.addEventListener("loadedmetadata", () => {
      pageCache.duration = Number.isFinite(el.duration) && el.duration > 0
        ? Math.round(el.duration)
        : pageCache.duration;
    });
  }

  /* An element added later (a player that mounts on interaction) is picked
     up the first time it starts playing, because `play` is an event on the
     element and bubbles through the capture listeners below. */
  document.addEventListener("play", (event) => {
    const el = event.target;
    if (el && (el.tagName === "VIDEO" || el.tagName === "AUDIO")) refreshActiveFromEvent(el);
  }, true);

  /* The toolbar Action asks for the page's media. The event page sends this
     message when the user clicks it, and the answer is the same item the
     prompt would have added. */
  api.runtime.onMessage.addListener((message) => {
    if (!message || message.kind !== "playlist:capture") return undefined;
    const el = activeElement() || document.querySelector("video, audio");
    if (!el) return Promise.resolve({ ok: false, reason: "no-media" });
    const item = classify.itemFromElement(elementInfo(el), pageCache.meta || readPage());
    if (!item) return Promise.resolve({ ok: false, reason: "not-playable" });
    return Promise.resolve({ ok: true, item: item });
  });

  /* Esc dismisses the prompt for this page view, without marking the site. */
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const prompt = document.getElementById(PROMPT_ID);
      if (prompt && !prompt.hidden) hidePrompt();
    }
  });

  /* Publish the panel URL EARLY. It is the harness's only way to learn the
     add-on's moz-extension:// UUID (the engine exposes it nowhere a harness
     can read), and it must happen before anything that can throw, because a
     page URL read after a failed line never runs. */
  publishPanelUrl();

  bootstrap();
})();
