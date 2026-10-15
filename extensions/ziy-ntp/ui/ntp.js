/* Ziy NTP — the new tab page.
 *
 * This file renders the page from browser.storage.local and wires every
 * interaction. It owns no state of its own: the store is authoritative, and
 * every mutation goes through lib/storage.js and re-renders from the result.
 *
 * Widget visibility comes from the config; a widget that is off is `hidden`,
 * never merely styled away, so assistive tech and the DOM assertions agree.
 */
(function () {
  "use strict";

  const model = ZiyNtpModel;
  const store = ZiyNtpStorage;
  const bg = globalThis.ZiyNtpBackground || null;

  /* -------------------------------------------------------------------------
   * Element lookups, resolved once.
   * ---------------------------------------------------------------------- */

  const $ = function (id) { return document.getElementById(id); };

  const el = {
    backdrop: $("backdrop"),
    gear: $("gear"),
    dashboard: $("dashboard"),
    dashboardClose: $("dashboard-close"),
    widgetToggles: $("widget-toggles"),

    /* search */
    search: $("search"),
    searchForm: $("search-form"),
    query: $("query"),
    engineButton: $("engine-button"),
    engineGlyph: $("engine-glyph"),
    engineMenu: $("engine-menu"),
    engineStatus: $("engine-status"),
    searchSubmit: $("search-submit"),

    /* clock */
    clock: $("clock"),
    clockTime: $("clock-time"),
    clockDate: $("clock-date"),
    clockAlt: $("clock-alt"),
    clockRead: $("clock-read"),
    clockStatus: $("clock-status"),

    /* stats */
    stats: $("stats"),
    statBlocked: $("stat-blocked"),
    statData: $("stat-data"),
    statTime: $("stat-time"),
    statsStatus: $("stats-status"),

    /* news */
    news: $("news"),
    newsList: $("news-list"),
    newsCount: $("news-count"),
    newsStatus: $("news-status"),
    newsEmpty: $("news-empty"),

    /* top sites */
    topsites: $("topsites"),
    topsitesHeading: $("topsites-heading"),
    topsitesMode: $("topsites-mode"),
    tiles: $("tiles"),
    tilesPager: $("tiles-pager"),
    pagePrev: $("page-prev"),
    pageNext: $("page-next"),
    pageCount: $("page-count"),
    topsitesEmpty: $("topsites-empty"),
    topsitesEmptyFrequent: $("topsites-empty-frequent"),
    emptyAdd: $("empty-add"),
    emptyFavoritesCta: $("empty-favorites-cta"),
    dashboardMode: $("dashboard-mode"),
    modeHint: $("mode-hint"),

    /* cards + all-off */
    cards: $("cards"),
    cardsHint: $("cards-hint"),
    allOff: $("all-off"),
    allOnCta: $("all-on-cta"),

    /* background picker */
    gradientSwatches: $("gradient-swatches"),
    backgroundSource: $("background-source"),
    customFileRow: $("custom-file-row"),
    customFile: $("custom-file"),
    customFileName: $("custom-file-name"),
    customRemove: $("custom-remove"),
    bgRefresh: $("bg-refresh"),

    /* dashboard clock + search */
    dashboardClock: $("dashboard-clock"),
    searchWidgetToggle: $("search-widget-toggle"),
    openOptions: $("open-options"),

    /* dialog */
    siteDialog: $("site-dialog"),
    siteForm: $("site-form"),
    siteName: $("site-name"),
    siteUrl: $("site-url"),
    siteUrlError: $("site-url-error"),
    siteCancel: $("site-cancel"),
    siteSave: $("site-save"),
    siteDialogTitle: $("site-dialog-title"),
  };

  /* -------------------------------------------------------------------------
   * In-memory view state: only what the renderer needs to draw, never a
   * second copy of anything the store already owns.
   * ---------------------------------------------------------------------- */

  const view = {
    config: model.defaultConfig(),
    favorites: [],
    frequent: [],
    engines: [],
    page: 0,
    /* The id of the site being edited, or null for a new one. */
    editing: null,
    /* True while a drag is in flight, so the click that ends it does not also
       navigate. */
    draggedId: null,
  };

  /* -------------------------------------------------------------------------
   * Small helpers.
   * ---------------------------------------------------------------------- */

  function setHidden(node, hidden) {
    node.hidden = !!hidden;
  }

  function announce(text) {
    el.statsStatus.textContent = text;
  }

  /* A stable initial for the favicon placeholder, so a tile without a favicon
     still reads as a site rather than a blank square. */
  function initialOf(title) {
    const text = String(title || "").trim();
    if (!text) return "?";
    return text.slice(0, 1).toUpperCase();
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (_err) {
      return "";
    }
  }

  /* -------------------------------------------------------------------------
   * Background.
   * ---------------------------------------------------------------------- */

  function applyBackground() {
    const b = view.config.background;
    const node = el.backdrop;
    node.style.backgroundImage = "";
    node.style.backgroundColor = "";
    if (b.source === "off") {
      /* The flat page colour from the tokens; nothing is painted. */
      node.style.backgroundColor = "var(--bg)";
      return;
    }
    if (b.source === "custom" && b.customDataUrl) {
      node.style.backgroundImage = 'url("' + b.customDataUrl.replace(/"/g, "%22") + '")';
      return;
    }
    if (b.source === "solid") {
      const solid = model.SOLIDS.find(function (s) { return s.id === b.solidId; });
      node.style.backgroundColor = solid ? "var(" + solid.token + ")" : "var(--bg)";
      return;
    }
    const gradient = model.GRADIENTS.find(function (g) { return g.id === b.gradientId; });
    node.style.backgroundImage = gradient ? gradient.css : model.GRADIENTS[0].css;
  }

  function renderGradientSwatches() {
    el.gradientSwatches.textContent = "";
    for (const gradient of model.GRADIENTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.dataset.gradientId = gradient.id;
      button.style.backgroundImage = gradient.css;
      button.setAttribute(
        "aria-pressed",
        String(view.config.background.gradientId === gradient.id),
      );
      button.setAttribute("aria-label", "Use the " + gradient.label + " backdrop");
      button.addEventListener("click", function () {
        store
          .setBackground({ source: "gradient", gradientId: gradient.id })
          .then(function (config) {
            view.config = config;
            render();
          });
      });
      el.gradientSwatches.appendChild(button);
    }
  }

  /* -------------------------------------------------------------------------
   * Widget visibility.
   * ---------------------------------------------------------------------- */

  function renderWidgetVisibility() {
    const widgets = view.config.widgets;
    setHidden(el.search, !widgets.search);
    setHidden(el.clock, !widgets.clock);
    setHidden(el.stats, !widgets.stats);
    setHidden(el.topsites, !widgets.topsites);
    setHidden(el.news, !widgets.news);
    if (widgets.news) loadNews();
    setHidden(el.cards, !view.config.cards);

    /* The backdrop is always painted; the switch controls whether it is the
       token default or nothing. */
    if (!widgets.background) {
      view.config.background.source = "off";
    }

    /* When every widget is off, the page says so and offers the way back. */
    const anyOn =
      widgets.search || widgets.clock || widgets.stats || widgets.topsites ||
      view.config.cards;
    setHidden(el.allOff, anyOn);
  }

  /* -------------------------------------------------------------------------
   * Search.
   * ---------------------------------------------------------------------- */

  function activeEngine() {
    const configured = view.config.engineId;
    if (configured) {
      const found = view.engines.find(function (e) { return e.id === configured; });
      if (found && found.checked) return found;
    }
    /* No explicit choice: follow the browser's default if it exposed one,
       otherwise the model's own default. */
    const browserDefault = view.engines.find(function (e) { return e.isDefault; });
    if (browserDefault && browserDefault.checked) return browserDefault;
    return (
      view.engines.find(function (e) { return e.id === model.DEFAULT_ENGINE_ID; }) ||
      view.engines[0] ||
      null
    );
  }

  function renderEngineButton() {
    const engine = activeEngine();
    if (!engine) return;
    el.engineGlyph.textContent = initialOf(engine.name);
    el.engineButton.setAttribute(
      "aria-label",
      "Search engine: " + engine.name + ". Change it.",
    );
    const how = engine.source === "browser"
      ? engine.name + ", the browser's own engine"
      : engine.name;
    el.engineStatus.textContent = "Searching with " + how + ".";
  }

  function renderEngineMenu() {
    el.engineMenu.textContent = "";
    for (const engine of view.engines) {
      if (!engine.checked) continue;
      const item = document.createElement("li");
      item.setAttribute("role", "presentation");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ntp-engine-option";
      button.setAttribute("role", "option");
      button.dataset.engineId = engine.id;
      const selected = activeEngine() && activeEngine().id === engine.id;
      button.setAttribute("aria-selected", String(!!selected));
      button.innerHTML =
        '<span class="glyph" aria-hidden="true">' +
        initialOf(engine.name) +
        "</span><span>" +
        engine.name.replace(/</g, "&lt;") +
        "</span>";
      button.addEventListener("click", function () {
        closeEngineMenu();
        /* Returned so the caller can await the write. */
        return store.setEngineId(engine.id).then(function (config) {
          view.config = config;
          renderEngineButton();
          renderEngineMenu();
          return config;
        });
      });
      item.appendChild(button);
      el.engineMenu.appendChild(item);
    }
  }

  function openEngineMenu() {
    renderEngineMenu();
    el.engineMenu.hidden = false;
    el.engineButton.setAttribute("aria-expanded", "true");
    const first = el.engineMenu.querySelector(".ntp-engine-option");
    if (first) first.focus();
  }

  function closeEngineMenu() {
    el.engineMenu.hidden = true;
    el.engineButton.setAttribute("aria-expanded", "false");
  }

  /* A query that looks like a URL is navigated; anything else is searched. */
  function looksLikeUrl(text) {
    const value = String(text || "").trim();
    if (!value) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;
    return /^[^\s/?#]+\.[a-z]{2,}(\/|$|\?|#)/i.test(value);
  }

  function submitSearch(event) {
    event.preventDefault();
    const query = el.query.value;
    if (!String(query || "").trim()) {
      el.query.focus();
      return;
    }
    if (looksLikeUrl(query)) {
      const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(query.trim())
        ? query.trim()
        : "https://" + query.trim();
      globalThis.location.href = target;
      return;
    }
    const engine = activeEngine();
    if (!engine) {
      announce("No search engine is available. Add one in the options page.");
      return;
    }
    if (engine.source === "browser") {
      /* A browser-provided engine has no template, so it goes through the
         browser's own search API. That API is desktop-shaped: it moves the
         current tab or opens a new one. When it is unavailable the page falls
         back to a direct navigation, using the model's own default engine so
         the fallback can never drift from the picker's default. */
      const api = globalThis.browser || globalThis.chrome;
      if (api && api.search && typeof api.search.search === "function") {
        api.search
          .search({ query: String(query).trim(), engine: engine.name })
          .catch(function () {
            /* Read the URL out of the model's own list so the fallback can
               never drift from the picker's default. */
            const fallback = model.FALLBACK_ENGINES.find(function (e) {
              return e.id === model.DEFAULT_ENGINE_ID;
            });
            const url = fallback && model.buildSearchUrl(fallback, query);
            if (url) {
              globalThis.location.href = url;
            } else {
              announce("That engine has no address to search with. Pick another one.");
            }
          });
        return;
      }
    }
    const url = model.buildSearchUrl(engine, query);
    if (!url) {
      announce("That engine has no address to search with. Pick another one.");
      return;
    }
    globalThis.location.href = url;
  }

  /* -------------------------------------------------------------------------
   * Clock.
   * ---------------------------------------------------------------------- */

  let clockTimer = null;

  function renderClock() {
    const now = new Date();
    const formatted = model.formatClock(now, view.config.clock24h);
    el.clockTime.textContent = formatted.time;
    el.clockDate.textContent = formatted.date;
    /* The text alternative is the full sentence, read on demand. */
    el.clockAlt.textContent =
      "The time is " + formatted.time + ", " + formatted.date + ".";
  }

  function startClock() {
    if (clockTimer !== null) return;
    clockTimer = globalThis.setInterval(renderClock, 1000);
  }

  function stopClock() {
    if (clockTimer === null) return;
    globalThis.clearInterval(clockTimer);
    clockTimer = null;
  }

  function renderDashboardClock() {
    el.dashboardClock.textContent = "";
    for (const option of [
      { id: "24", label: "24-hour" },
      { id: "12", label: "12-hour" },
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.clock = option.id;
      button.textContent = option.label;
      button.setAttribute(
        "aria-checked",
        String((option.id === "24") === view.config.clock24h),
      );
      button.addEventListener("click", function () {
        store.setClock24h(option.id === "24").then(function (config) {
          view.config = config;
          render();
        });
      });
      el.dashboardClock.appendChild(button);
    }
  }

  /* -------------------------------------------------------------------------
   * Stats.
   *
   * The count comes from the shields contract. When ziy-shields is not
   * installed the value is a real zero and the widget says so, rather than
   * hiding: the shell is honest about what it cannot know yet.
   * ---------------------------------------------------------------------- */

  async function loadStats() {
    let stats = { total: 0, via: "none" };

    /* Preferred path: ask the background page, which knows both the message
       and the shared-storage route. */
    try {
      if (bg && typeof bg.readStats === "function") {
        stats = await bg.readStats();
      }
    } catch (_err) {
      /* The background page is not reachable from here. Fall through to the
         storage key directly. */
    }

    /* Direct storage read as well, so a page opened before the event page
       settled still shows the recorded count. */
    try {
      const api = globalThis.browser || globalThis.chrome;
      if (api && api.storage && api.storage.local) {
        const all = await api.storage.local.get(model.SHIELDS_STORAGE_KEY);
        const value = all ? all[model.SHIELDS_STORAGE_KEY] : undefined;
        if (typeof value === "number" && isFinite(value)) {
          stats = { total: Math.max(0, Math.floor(value)), via: "storage" };
        } else if (
          value &&
          typeof value === "object" &&
          typeof value.total === "number"
        ) {
          stats = { total: Math.max(0, Math.floor(value.total)), via: "storage" };
        }
      }
    } catch (_err) {
      /* No storage permission in this context. The zero stands. */
    }

    renderStats(stats);
  }

  /* -------------------------------------------------------------------------
   * News.
   *
   * The section belongs to the NTP; the stories belong to ziy-news. The
   * message is the only coupling, and every failure path is a real state the
   * user can see rather than a console error: with ziy-news absent, absent
   * storage, or a snapshot this version does not understand, the region shows
   * its empty state and the rest of the page is untouched.
   * ---------------------------------------------------------------------- */

  async function loadNews() {
    const api = globalThis.browser || globalThis.chrome;
    if (!api || !api.runtime || typeof api.runtime.sendMessage !== "function") {
      renderNews(null);
      return;
    }
    try {
      const reply = await api.runtime.sendMessage(model.NEWS_EXTENSION_ID, {
        op: "feed.snapshot",
        from: "ziy-ntp@ziy.app",
        request: { n: 10 },
      });
      renderNews(reply && reply.ok === true ? reply.snapshot : null);
    } catch (_err) {
      /* ziy-news not installed, or refused. The NTP must not stall on a
         sibling being absent — this is the same contract shapes use. */
      renderNews(null);
    }
  }

  function renderNews(snapshot) {
    if (!el.newsList) return;
    el.newsList.textContent = "";
    /* A row is NTP-owned markup: one link per story, the title as its text and
       the source and time as muted text under it. Nothing from ziy-news's item
       shape reaches the page. */
    const usable = snapshot && snapshot.version === 1 && Array.isArray(snapshot.rows);
    if (!usable || !snapshot.rows.length) {
      el.newsEmpty.hidden = false;
      el.newsCount.textContent = "";
      el.newsStatus.textContent = "No stories in your window.";
      return;
    }
    el.newsEmpty.hidden = true;
    el.newsCount.textContent = snapshot.unread + " new";
    el.newsStatus.textContent = snapshot.rows.length + " stories";
    for (let i = 0; i < snapshot.rows.length; i++) {
      const row = snapshot.rows[i] || {};
      const link = document.createElement("a");
      link.className = "ntp-news__link";
      link.setAttribute("href", row.url || "#");
      const title = document.createElement("span");
      title.className = "ntp-news__title";
      title.textContent = row.title || "";
      link.appendChild(title);
      const meta = document.createElement("span");
      meta.className = "ntp-news__meta";
      meta.textContent = (row.sourceTitle || "") + " · " + (row.publishedLabel || "");
      link.appendChild(meta);
      const item = document.createElement("li");
      item.className = "ntp-news__item";
      item.setAttribute("role", "listitem");
      item.appendChild(link);
      el.newsList.appendChild(item);
    }
  }

  function renderStats(stats) {
    const blocked = stats && typeof stats.total === "number" ? stats.total : 0;
    el.statBlocked.textContent = model.formatCount(blocked);

    /* Data and time are derived from the blocked count and labelled as an
       estimate in the copy, because the shield layer owns the measured figure.
       The 128 bytes per request is the average we ship as the estimate. */
    const estimatedBytes = blocked * 128;
    el.statData.textContent = model.formatBytes(estimatedBytes);

    const minutes = Math.round((blocked * 0.9) / 60 * 10) / 10;
    el.statTime.textContent = minutes + " min";

    const shieldsPresent = !!(stats && stats.via && stats.via !== "none");
    el.stats.setAttribute("data-shields", shieldsPresent ? "present" : "absent");
    el.stats.querySelectorAll("dd").forEach(function (dd, index) {
      const base = dd.textContent.replace(/ \(estimate\)$/, "");
      dd.textContent = index === 0 ? base : base + " (estimate)";
    });
    el.statsStatus.textContent = shieldsPresent
      ? stats.total + " requests stopped so far."
      : "Ziy Shields is not installed yet, so nothing has been counted.";
  }

  /* -------------------------------------------------------------------------
   * Top sites.
   * ---------------------------------------------------------------------- */

  function renderTopsitesHeading() {
    const mode = view.config.topSitesMode;
    el.topsitesHeading.textContent =
      mode === "frequent" ? "Frequently visited" : "Favorites";
  }

  function renderModeControls() {
    for (const button of el.topsitesMode.querySelectorAll("button")) {
      button.setAttribute(
        "aria-checked",
        String(button.dataset.mode === view.config.topSitesMode),
      );
    }
    for (const button of el.dashboardMode.querySelectorAll("button")) {
      button.setAttribute(
        "aria-checked",
        String(button.dataset.mode === view.config.topSitesMode),
      );
    }
    el.modeHint.textContent =
      view.config.topSitesMode === "frequent"
        ? "Frequently visited is filled in for you from the pages you visit most, one per site. Ziy does not let it be edited by hand."
        : "Favorites is your own list. You choose what is on it and the order it sits in.";
  }

  function renderTiles() {
    const mode = view.config.topSitesMode;
    const list = mode === "frequent" ? view.frequent : view.favorites;
    const slice = model.pageOf(list, view.page);
    view.page = slice.page;

    el.tiles.textContent = "";

    const isFavorites = mode === "favorites";

    /* Empty states are exclusive with the grid. */
    setHidden(el.topsitesEmpty, !isFavorites || list.length > 0);
    setHidden(el.topsitesEmptyFrequent, isFavorites || list.length > 0);
    setHidden(el.tiles, list.length === 0);
    setHidden(el.tilesPager, slice.pages <= 1);

    if (list.length === 0) return;

    for (const site of slice.sites) {
      el.tiles.appendChild(buildTile(site, isFavorites));
    }

    /* The add tile is the empty slot in the grid, only in favorites mode. */
    if (isFavorites && list.length < model.MAX_TOP_SITES) {
      el.tiles.appendChild(buildAddTile());
    }

    el.pageCount.textContent = "Page " + (slice.page + 1) + " of " + slice.pages;
    el.pagePrev.disabled = slice.page === 0;
    el.pageNext.disabled = slice.page >= slice.pages - 1;
  }

  /* A tile is a button that navigates. The ⋮ options button is a second,
     separately focusable button inside it, per the spec. */
  function buildTile(site, editable) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.siteId = site.id;
    tile.setAttribute("role", "listitem");
    tile.draggable = editable;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tile-nav";
    button.dataset.siteId = site.id;
    button.setAttribute("role", "button");
    button.setAttribute(
      "aria-label",
      "Open " + site.title + " at " + hostOf(site.url),
    );
    button.style.cssText =
      "all:unset;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-2);width:100%;height:100%;cursor:inherit";

    const favicon = document.createElement("span");
    favicon.className = "favicon";
    favicon.setAttribute("aria-hidden", "true");
    favicon.textContent = initialOf(site.title);

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = site.title;

    button.appendChild(favicon);
    button.appendChild(label);
    tile.appendChild(button);

    if (editable) {
      const options = document.createElement("button");
      options.type = "button";
      options.className = "options";
      options.setAttribute("aria-haspopup", "menu");
      options.setAttribute("aria-label", "Options for " + site.title);
      options.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
      options.addEventListener("click", function (event) {
        event.stopPropagation();
        openTileMenu(site, options);
      });
      tile.appendChild(options);
    }

    /* Drag reorder. The pointer events carry ids, so a drop is expressed as a
       reorder call with an explicit order rather than as a DOM mutation. */
    tile.addEventListener("dragstart", function (event) {
      view.draggedId = site.id;
      tile.dataset.dragging = "true";
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", site.id);
      }
    });
    tile.addEventListener("dragend", function () {
      view.draggedId = null;
      tile.dataset.dragging = "false";
      clearDropTargets();
    });
    tile.addEventListener("dragover", function (event) {
      if (view.draggedId === null || view.draggedId === site.id) return;
      event.preventDefault();
      clearDropTargets();
      tile.dataset.dropTarget = "true";
    });
    tile.addEventListener("drop", function (event) {
      event.preventDefault();
      clearDropTargets();
      if (view.draggedId === null || view.draggedId === site.id) return;
      reorderByDrop(site.id);
    });

    /* Keyboard reorder: Ctrl+Arrow moves the focused tile, per the spec, and
       the move is announced. */
    tile.addEventListener("keydown", function (event) {
      if (!editable) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      let delta = 0;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") delta = 1;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") delta = -1;
      else return;
      event.preventDefault();
      moveTile(site.id, delta);
    });

    return tile;
  }

  function clearDropTargets() {
    for (const tile of el.tiles.querySelectorAll(".tile")) {
      tile.dataset.dropTarget = "false";
    }
  }

  /* Move a tile, then re-read from the store so the renderer shows what was
     actually persisted. */
  function moveTile(id, delta) {
    store
      .mutateTopSites("favorites", function (list) {
        return model.moveTopSite(list, id, delta);
      })
      .then(function (result) {
        view.favorites = result.sites;
        if (!result.ok) announce(result.error);
        renderTiles();
        refocusTile(id);
      });
  }

  function reorderByDrop(targetId) {
    store
      .mutateTopSites("favorites", function (list) {
        const dragged = list.find(function (s) { return s.id === view.draggedId; });
        const target = list.find(function (s) { return s.id === targetId; });
        if (!dragged || !target) return { ok: false, sites: list, error: "That site is gone." };
        const rest = list.filter(function (s) {
          return s.id !== dragged.id && s.id !== target.id;
        });
        const at = list.indexOf(target);
        rest.splice(at, 0, dragged);
        return { ok: true, sites: rest };
      })
      .then(function (result) {
        view.favorites = result.sites;
        renderTiles();
        refocusTile(result.sites.length ? view.draggedId : null);
      });
  }

  function refocusTile(id) {
    if (!id) return;
    const tile = el.tiles.querySelector('.tile[data-site-id="' + id + '"] .tile-nav');
    if (tile) tile.focus();
  }

  function buildAddTile() {
    const tile = document.createElement("div");
    tile.className = "tile tile-add";
    tile.setAttribute("role", "listitem");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tile-nav";
    button.setAttribute("aria-label", "Add a site to your favorites");
    button.innerHTML =
      '<span class="glyph" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
      "</span><span class=\"label\">Add a site</span>";
    button.addEventListener("click", function () {
      openSiteDialog(null);
    });
    tile.appendChild(button);
    return tile;
  }

  /* The tile options menu. It is a small popup menu; Esc closes it and returns
     focus to the button that opened it. */
  function openTileMenu(site, anchor) {
    closeTileMenu();
    const menu = document.createElement("div");
    menu.className = "ntp-engine-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Options for " + site.title);
    menu.style.position = "absolute";
    menu.style.zIndex = "30";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ntp-engine-option";
    edit.setAttribute("role", "menuitem");
    edit.textContent = "Edit";
    edit.addEventListener("click", function () {
      closeTileMenu();
      openSiteDialog(site);
    });

    const moveLeft = document.createElement("button");
    moveLeft.type = "button";
    moveLeft.className = "ntp-engine-option";
    moveLeft.setAttribute("role", "menuitem");
    moveLeft.textContent = "Move earlier";
    moveLeft.addEventListener("click", function () {
      closeTileMenu();
      moveTile(site.id, -1);
    });

    const moveRight = document.createElement("button");
    moveRight.type = "button";
    moveRight.className = "ntp-engine-option";
    moveRight.setAttribute("role", "menuitem");
    moveRight.textContent = "Move later";
    moveRight.addEventListener("click", function () {
      closeTileMenu();
      moveTile(site.id, 1);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ntp-engine-option";
    remove.setAttribute("role", "menuitem");
    remove.textContent = "Remove";
    remove.style.color = "var(--danger)";
    remove.addEventListener("click", function () {
      closeTileMenu();
      removeSite(site.id);
    });

    menu.appendChild(edit);
    menu.appendChild(moveLeft);
    menu.appendChild(moveRight);
    menu.appendChild(remove);

    const holder = anchor.closest(".tile") || el.topsites;
    holder.style.position = "relative";
    holder.appendChild(menu);
    menu.dataset.tileMenu = "true";
    /* Anchor the menu to the button that opened it. */
    const rect = anchor.getBoundingClientRect();
    const holderRect = holder.getBoundingClientRect();
    menu.style.top = rect.bottom - holderRect.top + 4 + "px";
    menu.style.right = holderRect.right - rect.right + "px";
    menu.style.left = "auto";
    menu.hidden = false;
    edit.focus();

    /* Esc closes and restores focus; a click outside closes. */
    const onKey = function (event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeTileMenu();
        anchor.focus();
      }
    };
    const onDocClick = function (event) {
      if (menu.contains(event.target) || anchor.contains(event.target)) return;
      closeTileMenu();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onDocClick, true);
    menu._teardown = function () {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onDocClick, true);
    };
  }

  function closeTileMenu() {
    for (const menu of document.querySelectorAll("[data-tile-menu]")) {
      if (typeof menu._teardown === "function") menu._teardown();
      menu.remove();
    }
  }

  function removeSite(id) {
    store
      .mutateTopSites("favorites", function (list) {
        return model.removeTopSite(list, id);
      })
      .then(function (result) {
        view.favorites = result.sites;
        renderTiles();
        announce("Site removed from your favorites.");
      });
  }

  /* -------------------------------------------------------------------------
   * Add / Edit dialog.
   * ---------------------------------------------------------------------- */

  function openSiteDialog(site) {
    view.editing = site ? site.id : null;
    el.siteDialogTitle.textContent = site ? "Edit site" : "Add a site";
    el.siteName.value = site ? site.title : "";
    el.siteUrl.value = site ? site.url : "";
    setFieldError(null);
    el.siteSave.textContent = site ? "Save" : "Add";
    el.siteDialog.showModal();
    /* Focus starts in the name field, per the spec. */
    (site ? el.siteUrl : el.siteName).focus();
  }

  function setFieldError(message) {
    const hasError = !!message;
    el.siteUrlError.textContent = message || "";
    setHidden(el.siteUrlError, !hasError);
    el.siteUrl.setAttribute("aria-invalid", String(hasError));
  }

  function onSiteSubmit(event) {
    event.preventDefault();
    const name = el.siteName.value.trim();
    const url = el.siteUrl.value.trim();
    const check = model.validateSiteUrl(url);
    if (!check.ok) {
      setFieldError(check.error);
      el.siteUrl.focus();
      return;
    }
    setFieldError(null);
    const title = name || check.host;
    const promise =
      view.editing === null
        ? store.mutateTopSites("favorites", function (list) {
            return model.addTopSite(list, { url: check.url, title: title });
          })
        : store.mutateTopSites("favorites", function (list) {
            return model.editTopSite(list, view.editing, { url: check.url, title: title });
          });
    promise.then(function (result) {
      view.favorites = result.sites;
      el.siteDialog.close();
      if (!result.ok) {
        announce(result.error);
        return;
      }
      renderTiles();
      announce(view.editing === null ? "Site added to your favorites." : "Site updated.");
    });
  }

  /* -------------------------------------------------------------------------
   * Dashboard.
   * ---------------------------------------------------------------------- */

  function buildToggle(id, label, description, value, onChange) {
    const row = document.createElement("div");
    row.className = "toggle-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.id = "toggle-" + id;
    input.checked = !!value;
    input.setAttribute("aria-describedby", "desc-" + id);
    const text = document.createElement("span");
    text.className = "text";
    const labelEl = document.createElement("label");
    labelEl.setAttribute("for", input.id);
    labelEl.textContent = label;
    const desc = document.createElement("p");
    desc.className = "desc";
    desc.id = "desc-" + id;
    desc.textContent = description || "";
    text.appendChild(labelEl);
    if (description) text.appendChild(desc);
    row.appendChild(input);
    row.appendChild(text);
    input.addEventListener("change", function () {
      onChange(input.checked, input);
    });
    return row;
  }

  function renderDashboard() {
    /* Widget toggles, one row per widget. */
    el.widgetToggles.textContent = "";
    const descriptions = {
      background: "The colour or picture behind the page.",
      search: "The search box and its engine switcher.",
      topsites: "Your shortcuts, and the mode that decides what fills them.",
      clock: "The time and date, and the 12 or 24-hour format.",
      stats: "How many requests Ziy has stopped for you.",
      news: "The stories Ziy News has collected in your window.",
    };
    for (const widget of model.WIDGETS) {
      el.widgetToggles.appendChild(
        buildToggle(
          "widget-" + widget.id,
          widget.label,
          descriptions[widget.id],
          view.config.widgets[widget.id],
          function (checked) {
            store.setWidget(widget.id, checked).then(function (config) {
              view.config = config;
              render();
              if (widget.id === "background") applyBackground();
            });
          },
        ),
      );
    }
    /* Cards, the recon's separate card switch (S51). */
    el.widgetToggles.appendChild(
      buildToggle(
        "widget-cards",
        "Cards",
        "A section for cards on the new tab page. Off until there is something to fill it with.",
        view.config.cards,
        function (checked) {
          store.setCards(checked).then(function (config) {
            view.config = config;
            render();
          });
        },
      ),
    );

    /* Search widget toggle mirrors the widget row so the dashboard's own Search
       group has a control next to its engine button. */
    el.searchWidgetToggle.checked = !!view.config.widgets.search;
    el.searchWidgetToggle.setAttribute(
      "aria-describedby",
      "search-widget-desc",
    );

    /* Background source segmented control. */
    el.backgroundSource.textContent = "";
    for (const source of model.BACKGROUND_SOURCES) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.backgroundSource = source.id;
      button.textContent = source.label;
      button.setAttribute(
        "aria-checked",
        String(view.config.background.source === source.id),
      );
      button.addEventListener("click", function () {
        store.setBackground({ source: source.id }).then(function (config) {
          view.config = config;
          render();
        });
      });
      el.backgroundSource.appendChild(button);
    }

    /* Gradient swatches. */
    renderGradientSwatches();

    /* The custom-upload row is only relevant in the custom source. */
    setHidden(
      el.customFileRow,
      view.config.background.source !== "custom",
    );
    el.customFileName.textContent = view.config.background.customName || "";
    el.bgRefresh.checked = !!view.config.background.refreshOnNewTab;

    /* Top sites mode + clock segmented controls. */
    el.dashboardMode.textContent = "";
    for (const mode of model.TOP_SITE_MODES) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.mode = mode;
      button.textContent = mode === "favorites" ? "Favorites" : "Frequently visited";
      button.setAttribute(
        "aria-checked",
        String(view.config.topSitesMode === mode),
      );
      button.addEventListener("click", function () {
        setMode(mode);
      });
      el.dashboardMode.appendChild(button);
    }
    renderDashboardClock();
  }

  function setMode(mode) {
    /* Returns the promise so a caller can await the write and the re-render. */
    return store.setTopSitesMode(mode).then(function (config) {
      view.config = config;
      view.page = 0;
      const ready = mode === "frequent" ? loadFrequent() : Promise.resolve();
      return ready.then(function () {
        render();
        return config;
      });
    });
  }

  function openDashboard() {
    renderDashboard();
    el.dashboard.hidden = false;
    el.gear.setAttribute("aria-expanded", "true");
    el.dashboardClose.focus();
  }

  function closeDashboard() {
    el.dashboard.hidden = true;
    el.gear.setAttribute("aria-expanded", "false");
    el.gear.focus();
  }

  /* -------------------------------------------------------------------------
   * Frequently visited.
   *
   * The portable source is browser.topSites (permission "topSites"). Where it
   * is unavailable, browser.history.search (permission "history") is the
   * documented substitute. If neither is available the list is genuinely empty
   * and the empty state says so.
   * ---------------------------------------------------------------------- */

  async function loadFrequent() {
    const api = globalThis.browser || globalThis.chrome;
    let sites = [];

    if (api && api.topSites && typeof api.topSites.get === "function") {
      try {
        const results = await api.topSites.get({
          includeFavicon: true,
          onePerDomain: true,
          limit: model.TILES_PER_PAGE,
        });
        sites = (results || [])
          .filter(function (entry) { return entry && entry.url; })
          .map(function (entry) {
            return {
              id: "frequent:" + entry.url,
              url: entry.url,
              title: entry.title || hostOf(entry.url),
              position: 0,
              mode: "frequent",
            };
          });
      } catch (_err) {
        sites = [];
      }
    }

    if (!sites.length && api && api.history && typeof api.history.search === "function") {
      try {
        const results = await api.history.search({
          text: "",
          maxResults: model.TILES_PER_PAGE,
          startTime: 0,
        });
        sites = (results || [])
          .filter(function (entry) { return entry && entry.url; })
          .map(function (entry) {
            return {
              id: "frequent:" + entry.url,
              url: entry.url,
              title: entry.title || hostOf(entry.url),
              position: 0,
              mode: "frequent",
            };
          });
      } catch (_err) {
        sites = [];
      }
    }

    view.frequent = model.normaliseTopSites(sites, "frequent");
  }

  /* -------------------------------------------------------------------------
   * Cards (recon S51). Ziy ships no card content, so the region says what it
     is and why it is empty rather than pretending.
   * ---------------------------------------------------------------------- */

  function renderCards() {
    setHidden(el.cards, !view.config.cards);
    if (!view.config.cards) return;
    el.cardsHint.textContent =
      "Cards are switched on. Ziy ships nothing to put in them yet — there is no " +
      "sponsored-image network behind this page, and nothing is fetched to fill it.";
  }

  /* -------------------------------------------------------------------------
   * Render.
   * ---------------------------------------------------------------------- */

  function render() {
    applyBackground();
    renderWidgetVisibility();
    renderCards();
    renderEngineButton();
    renderTopsitesHeading();
    renderModeControls();
    renderTiles();
    renderDashboard();
  }

  /* -------------------------------------------------------------------------
   * Boot.
   * ---------------------------------------------------------------------- */

  async function loadEngines() {
    let available = null;
    const api = globalThis.browser || globalThis.chrome;

    /* Preferred: the browser's own engine list. */
    if (api && api.search && typeof api.search.get === "function") {
      try {
        const engines = await api.search.get();
        if (Array.isArray(engines) && engines.length) {
          available = engines
            .filter(function (engine) { return engine && typeof engine.name === "string"; })
            .map(function (engine) {
              return {
                id: "browser:" + engine.name,
                name: engine.name,
                urlTemplate: null,
                source: "browser",
                isDefault: !!engine.isDefault,
              };
            });
        }
      } catch (_err) {
        available = null;
      }
    }

    /* Fallback: our own list. */
    if (!available) available = model.defaultEngines();

    const stored = await store.loadEngines();
    view.engines = model.mergeEngines(available, stored);
  }

  async function load() {
    view.config = await store.loadConfig();
    view.favorites = await store.loadTopSites("favorites");
    await loadEngines();
    if (view.config.topSitesMode === "frequent") await loadFrequent();
    render();
    renderClock();
    startClock();
    await loadStats();
  }

  /* -------------------------------------------------------------------------
   * Wiring.
   * ---------------------------------------------------------------------- */

  function wire() {
    el.gear.addEventListener("click", function () {
      if (el.dashboard.hidden) openDashboard();
      else closeDashboard();
    });
    el.dashboardClose.addEventListener("click", closeDashboard);

    /* Esc in the dashboard closes it and returns focus to the gear. */
    el.dashboard.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeDashboard();
      }
    });

    el.searchForm.addEventListener("submit", submitSearch);
    el.engineButton.addEventListener("click", function () {
      if (el.engineMenu.hidden) openEngineMenu();
      else {
        closeEngineMenu();
        el.engineButton.focus();
      }
    });

    /* Esc in the engine menu closes it and returns focus to the button. */
    el.engineMenu.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeEngineMenu();
        el.engineButton.focus();
      }
    });
    document.addEventListener("click", function (event) {
      if (el.engineMenu.hidden) return;
      if (el.engineMenu.contains(event.target) || el.engineButton.contains(event.target)) {
        return;
      }
      closeEngineMenu();
    });

    el.clockRead.addEventListener("click", function () {
      el.clockStatus.textContent = el.clockAlt.textContent;
    });

    /* Top sites mode, from the page itself. */
    el.topsitesMode.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      setMode(button.dataset.mode);
    });

    el.emptyAdd.addEventListener("click", function () { openSiteDialog(null); });
    el.emptyFavoritesCta.addEventListener("click", function () { setMode("favorites"); });
    el.allOnCta.addEventListener("click", function () {
      const on = {};
      for (const widget of model.WIDGETS) on[widget.id] = true;
      store.saveConfig({ widgets: on }).then(function (config) {
        view.config = config;
        render();
        applyBackground();
      });
    });

    el.pagePrev.addEventListener("click", function () {
      view.page = Math.max(0, view.page - 1);
      renderTiles();
    });
    el.pageNext.addEventListener("click", function () {
      view.page += 1;
      renderTiles();
    });

    /* Background. */
    el.customFile.addEventListener("change", function () {
      const file = el.customFile.files && el.customFile.files[0];
      if (!file) return;
      /* Read as a data URL, so the extension holds bytes it can render and no
         filesystem path. */
      const reader = new FileReader();
      reader.onload = function () {
        store
          .setCustomBackground(String(reader.result), file.name)
          .then(function (config) {
            view.config = config;
            render();
          });
      };
      reader.onerror = function () {
        announce("That picture could not be read. Try another file.");
      };
      reader.readAsDataURL(file);
    });

    el.customRemove.addEventListener("click", function () {
      store
        .setBackground({
          source: "gradient",
          customDataUrl: null,
          customName: null,
        })
        .then(function (config) {
          view.config = config;
          render();
        });
    });

    el.bgRefresh.addEventListener("change", function () {
      store
        .setBackground({ refreshOnNewTab: el.bgRefresh.checked })
        .then(function (config) {
          view.config = config;
          render();
        });
    });

    el.searchWidgetToggle.addEventListener("change", function () {
      store.setWidget("search", el.searchWidgetToggle.checked).then(function (config) {
        view.config = config;
        render();
      });
    });

    el.openOptions.addEventListener("click", function () {
      const api = globalThis.browser || globalThis.chrome;
      if (api && api.runtime && typeof api.runtime.openOptionsPage === "function") {
        api.runtime.openOptionsPage();
      }
    });

    /* Dialog. */
    el.siteForm.addEventListener("submit", onSiteSubmit);
    el.siteCancel.addEventListener("click", function () { el.siteDialog.close(); });

    /* Re-render when the config changes underneath us — another tab, the
       dashboard in a different window, or the shell pushing a patch. */
    const api = globalThis.browser || globalThis.chrome;
    if (api && api.storage && api.storage.local && api.storage.local.onChanged) {
      api.storage.local.onChanged.addListener(function (changes, area) {
        if (area !== "local") return;
        if (!changes[model.STORAGE_KEYS.config]) return;
        store.loadConfig().then(function (config) {
          view.config = config;
          render();
        });
      });
    }
  }

  wire();

  /* Boot. `load` is also exposed above for the verification harness. */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }

  /* The page exposes its render function so the verification harness can assert
     against the same code path rather than a re-implementation. */
  globalThis.ZiyNtpPage = {
    render,
    view,
    load,
    setMode,
    loadFrequent,
    loadEngines,
    loadStats,
    loadNews,
  };
})();
