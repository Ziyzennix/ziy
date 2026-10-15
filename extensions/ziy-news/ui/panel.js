/* Ziy news — the sidebar panel.
 *
 * The panel is the reference's News sidebar: a list of stories with a source,
 * a time and an image, unread state, and the "open links where" setting that
 * the reference has and that S42/F10 call out. It reads through the
 * background page's ops and never fetches.
 *
 * Accessibility and keyboard (design/components.md + WCAG 2.2):
 *   - the feed is a real list: role="list", one role="listitem" per story
 *   - the row is a single tab stop; j/k move between rows, Enter opens, m
 *     toggles read. This is what the reference's list does, and it is
 *     documented in the panel's own help
 *   - refresh status is role="status" (polite), a source failure is
 *     role="alert"
 *   - focus-visible is never suppressed
 *   - the panel is a labelled region, and the scroll area is focusable
 */
(function () {
  "use strict";

  const ui = globalThis.ZiyNewsUi;
  const COPY = ui.COPY;

  /* View state. Deliberately small: a panel that keeps a lot of state keeps a
   * lot of bugs. */
  const view = {
    rows: [],
    filter: { category: "all", query: "" },
    settings: null,
    sources: [],
    refresh: null,
    focusIndex: -1,
    loading: true,
    error: null,
    helpOpen: false,
  };

  /* --------------------------------------------------------------------- */
  /* Wiring                                                               */
  /* --------------------------------------------------------------------- */

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    cacheElements();
    bindControls();
    load();
    /* The alarm path updates the panel while it is open, so a user who leaves
     * it on the side sees new stories without reloading the page. */
    window.setInterval(function () {
      if (document.visibilityState === "visible") loadFeed({ quiet: true });
    }, 60000);
  });

  /* Element ids the panel caches once, in load order. */
  let el = {};
  function cacheElements() {
    el = {
      root: document.body,
      status: ui.byId("news-status"),
      errors: ui.byId("news-errors"),
      list: ui.byId("news-list"),
      refreshBtn: ui.byId("news-refresh"),
      unread: ui.byId("news-unread"),
      markAll: ui.byId("news-markall"),
      category: ui.byId("news-category"),
      search: ui.byId("news-search"),
      settingsBtn: ui.byId("news-settings"),
      helpBtn: ui.byId("news-help"),
      help: ui.byId("news-help-body"),
      helpList: ui.byId("news-help-list"),
      empty: ui.byId("news-empty"),
      count: ui.byId("news-count"),
    };
  }

  function bindControls() {
    el.refreshBtn.addEventListener("click", function () {
      refreshNow();
    });
    el.markAll.addEventListener("click", function () {
      markAllRead();
    });
    el.category.addEventListener("change", function () {
      view.filter.category = el.category.value || "all";
      renderFeed();
    });
    el.search.addEventListener("input", function () {
      view.filter.query = el.search.value || "";
      renderFeed();
    });
    el.settingsBtn.addEventListener("click", function () {
      ui.op("feed.open", { url: "about:addons" }).catch(function () {
        /* The options page is opened by the browser's own add-on manager; if
         * that is unavailable we say so rather than failing silently. */
        ui.announce(el.status, "Source settings open from the add-on manager.");
      });
    });
    el.helpBtn.addEventListener("click", function () {
      view.helpOpen = !view.helpOpen;
      el.help.hidden = !view.helpOpen;
      el.helpBtn.setAttribute("aria-expanded", String(view.helpOpen));
    });

    document.addEventListener("keydown", onKeyDown);
  }

  /* --------------------------------------------------------------------- */
  /* Loading                                                              */
  /* --------------------------------------------------------------------- */

  async function loadFeed(options) {
    const opts = options || {};
    try {
      const [sources, settings, refresh, feed] = await Promise.all([
        ui.op("feed.sources.get"),
        ui.op("feed.settings.get"),
        ui.op("feed.refresh.status"),
        ui.op("feed.list", { filter: view.filter }),
      ]);
      view.sources = sources.sources;
      view.settings = settings.settings;
      view.refresh = refresh.refresh;
      view.rows = feed.feed.rows;
      view.error = null;
      /* The loading row is replaced by the real feed, whichever it is. Without
       * this the panel would show "Gathering your feeds…" forever on success,
       * because nothing else ever clears it. */
      view.loading = false;
      render();
      if (!opts.quiet) announceLoaded();
    } catch (err) {
      view.error = err;
      view.loading = false;
      render();
      if (!opts.quiet) ui.announce(el.errors, COPY.offlineBody);
    }
  }

  function load() {
    loadFeed({ quiet: false });
  }

  function announceLoaded() {
    const unread = view.rows.filter(function (row) { return !row.read; }).length;
    ui.announce(el.status, ui.plural(unread, "new story", "new stories") + " in view.");
  }

  async function refreshNow() {
    el.refreshBtn.disabled = true;
    el.refreshBtn.textContent = COPY.refreshing;
    el.root.setAttribute("aria-busy", "true");
    ui.announce(el.status, COPY.refreshing);
    try {
      const result = await ui.op("feed.refresh.now");
      view.refresh = { lastRunAt: Date.now(), lastRunMs: result.refresh.ms,
        lastResult: result.refresh.failed === 0 && result.refresh.due > 0 ? "ok"
          : (result.refresh.failed > 0 ? "partial" : "idle"),
        sources: result.refresh.due, ok: result.refresh.ok,
        unchanged: result.refresh.unchanged, failed: result.refresh.failed,
        itemsAdded: result.refresh.itemsAdded };
      await loadFeed({ quiet: false });
    } catch (err) {
      view.error = err;
      render();
      ui.announce(el.errors, err.message || COPY.offlineBody);
    } finally {
      el.refreshBtn.disabled = false;
      el.refreshBtn.textContent = COPY.refresh;
      el.root.setAttribute("aria-busy", "false");
    }
  }

  async function markAllRead() {
    try {
      const result = await ui.op("feed.markAllRead", { filter: view.filter });
      ui.announce(el.status, result.marked === 0
        ? "Nothing to mark."
        : ui.plural(result.marked, "story") + " marked read.");
      await loadFeed({ quiet: true });
    } catch (err) {
      ui.announce(el.errors, "Could not mark the stories read: " + (err.message || "unknown"));
    }
  }

  async function toggleRead(key) {
    const row = view.rows.find(function (entry) { return entry.key === key; });
    if (!row) return;
    try {
      await ui.op("feed.markRead", { keys: [key], read: !row.read });
      row.read = !row.read;
      renderFeed();
      renderCounts();
    } catch (err) {
      ui.announce(el.errors, "Could not change the read state.");
    }
  }

  async function openRow(row) {
    try {
      /* The background page reads the setting and opens the destination, so
       * the panel and the setting never disagree about where a link lands. */
      const result = await ui.op("feed.open", { url: row.link });
      /* Opening counts as reading in the reference's model; we match it, and
       * the panel keeps the row in place rather than removing it. */
      await ui.op("feed.markRead", { keys: [row.key], read: true });
      row.read = true;
      renderFeed();
      renderCounts();
      ui.announce(el.status, "Opened in the " + (result.where === "tab" ? "new tab" : "current tab") + ".");
    } catch (err) {
      ui.announce(el.errors, "Could not open that story: " + (err.message || "unknown"));
    }
  }

  /* --------------------------------------------------------------------- */
  /* Rendering                                                            */
  /* --------------------------------------------------------------------- */

  function render() {
    renderCategoryFilter();
    renderErrors();
    renderCounts();
    renderFeed();
    renderStatus();
  }

  function renderCategoryFilter() {
    const previous = el.category.value;
    el.category.textContent = "";
    el.category.appendChild(ui.el("option", { value: "all", text: "All sources" }));
    const cats = {};
    for (const source of view.sources) {
      if (source.enabled === false) continue;
      cats[source.category] = (cats[source.category] || 0) + 1;
    }
    for (const name of Object.keys(cats).sort()) {
      el.category.appendChild(ui.el("option", {
        value: name,
        text: name + " (" + cats[name] + ")",
      }));
    }
    if (Array.prototype.some.call(el.category.options, function (o) { return o.value === previous; })) {
      el.category.value = previous;
    } else {
      view.filter.category = "all";
      el.category.value = "all";
    }
  }

  function renderErrors() {
    el.errors.textContent = "";
    const failing = view.sources.filter(function (s) { return s.lastError; });
    if (failing.length === 0) {
      el.errors.hidden = true;
      return;
    }
    el.errors.hidden = false;
    el.errors.setAttribute("role", "alert");
    const heading = ui.el("p", { class: "news-errors__title", text: COPY.errorTitle });
    const list = ui.el("ul", { class: "news-errors__list" });
    for (const source of failing) {
      const error = source.lastError || {};
      const kind = error.kind || "unknown";
      const when = error.at ? ui.relativeLabel(error.at, Date.now()) : "";
      list.appendChild(ui.el("li", {
        class: "news-errors__item",
        text: source.title + " — " + messageForError(kind, error.message) + (when ? " (" + when + ")" : ""),
      }));
    }
    el.errors.appendChild(heading);
    el.errors.appendChild(list);
  }

  /**
   * Turns a fetch failure kind into words a person can act on. The kind comes
   * from lib/feed/fetcher.js, which classifies real HTTP outcomes.
   */
  function messageForError(kind, message) {
    const map = {
      gone: "the feed is gone (404). Remove the source or fix the URL.",
      forbidden: "the site refused the request (403).",
      "rate-limited": "the site asked us to slow down (429). We will wait longer.",
      "server-error": "the site had a server error.",
      timeout: "the feed did not answer in time.",
      empty: "the feed answered with nothing.",
      "no-response": "the fetch returned nothing.",
      offline: "there is no network.",
    };
    return map[kind] || message || "something went wrong.";
  }

  function renderCounts() {
    const unread = view.rows.filter(function (row) { return !row.read; }).length;
    el.unread.textContent = ui.plural(unread, "new story", "new stories");
    el.count.textContent = String(view.rows.length);
    el.markAll.disabled = unread === 0;
  }

  function renderFeed() {
    if (view.loading) {
      el.list.textContent = "";
      el.list.appendChild(ui.el("li", {
        class: "news-row news-row--loading",
        text: COPY.loading,
      }));
      el.empty.hidden = true;
      return;
    }
    el.list.textContent = "";
    if (view.rows.length === 0) {
      el.empty.hidden = false;
      const hasSources = view.sources.some(function (s) { return s.enabled !== false; });
      ui.byId("news-empty-title").textContent = hasSources ? COPY.emptyTitle : COPY.noSourcesTitle;
      ui.byId("news-empty-body").textContent = hasSources ? COPY.emptyBody : COPY.noSourcesBody;
      ui.byId("news-empty-action").textContent = hasSources ? COPY.emptyAction : COPY.noSourcesAction;
      return;
    }
    el.empty.hidden = true;
    for (let i = 0; i < view.rows.length; i++) {
      el.list.appendChild(renderRow(view.rows[i], i));
    }
    if (view.focusIndex >= 0 && view.focusIndex < view.rows.length) {
      const focused = el.list.children[view.focusIndex];
      if (focused && focused.firstElementChild) focused.firstElementChild.focus();
    }
  }

  /**
   * One story row. The whole row is a button, because that is what the user
   * is going to press, and it carries the accessible name the row needs:
   * title, source, time, read state.
   */
  function renderRow(row, index) {
    const title = row.title || "(no title)";
    const isRead = !!row.read;
    const showImage = view.settings ? view.settings.showImages : true;

    const nameParts = [title, "from " + (row.sourceTitle || "a source"),
      ui.relativeLabel(row.published, Date.now()), isRead ? "read" : "unread"];
    const button = ui.el("button", {
      class: "news-row__button" + (isRead ? " news-row__button--read" : ""),
      type: "button",
      dataset: { index: String(index), key: row.key || "" },
      "aria-label": nameParts.join(", "),
      onclick: function () { openRow(row); },
    });

    const text = ui.el("div", { class: "news-row__text" });
    text.appendChild(ui.el("p", { class: "news-row__title", text: title }));
    const meta = ui.el("p", { class: "news-row__meta" });
    meta.appendChild(ui.el("span", { class: "news-row__source", text: row.sourceTitle || "unknown source" }));
    meta.appendChild(ui.el("span", { class: "news-row__dot", text: "·" }));
    meta.appendChild(ui.el("time", {
      class: "news-row__time",
      text: ui.relativeLabel(row.published, Date.now()),
    }));
    if (isRead) meta.appendChild(ui.el("span", { class: "news-row__badge", text: "read" }));
    text.appendChild(meta);
    if (row.snippet) {
      text.appendChild(ui.el("p", { class: "news-row__snippet", text: row.snippet }));
    }
    /* An audio enclosure marks a podcast episode. The row says so in text,
     * which is also how a screen reader user learns it is playable audio. */
    if (row.attachments && row.attachments.some(function (a) { return a.kind === "audio"; })) {
      text.appendChild(ui.el("p", { class: "news-row__audio", text: "Has an audio enclosure" }));
    }
    button.appendChild(text);

    if (showImage && row.images && row.images.length > 0) {
      const figure = ui.el("figure", { class: "news-row__figure" });
      const img = ui.el("img", {
        class: "news-row__image",
        src: row.images[0],
        alt: "",
        loading: "lazy",
        decoding: "async",
        width: "72",
        height: "72",
      });
      /* A feed image that fails to load leaves the figure empty rather than
       * showing a broken icon, which is a row-level decoration. */
      img.addEventListener("error", function () { figure.hidden = true; });
      figure.appendChild(img);
      button.appendChild(figure);
    }

    return ui.el("li", {
      class: "news-row",
      dataset: { key: row.key || "", read: String(isRead) },
    }, [button]);
  }

  function renderStatus() {
    el.status.textContent = "";
    const line = [];
    if (view.refresh && view.refresh.lastRunAt) {
      if (view.refresh.lastResult === "ok") {
        line.push(COPY.refreshOk(view.refresh.sources, view.refresh.unchanged,
          view.refresh.itemsAdded, view.refresh.lastRunMs));
      } else if (view.refresh.lastResult === "partial") {
        line.push(COPY.refreshPartial(view.refresh.ok, view.refresh.failed));
      } else {
        line.push(COPY.refreshIdle);
      }
    } else {
      line.push(COPY.refreshNeverRun);
    }
    el.status.appendChild(ui.el("span", { class: "news-status__line", text: line.join(" ") }));
    const unread = view.rows.filter(function (r) { return !r.read; }).length;
    el.status.appendChild(ui.el("span", {
      class: "news-status__unread",
      text: ui.plural(unread, "new story", "new stories"),
    }));
  }

  /* --------------------------------------------------------------------- */
  /* Keyboard.                                                            */
  /* --------------------------------------------------------------------- */

  /**
   * j/k are the row-movement keys the reference's list uses, with the arrow
   * keys doing the same thing because they are what a user expects. Enter
   * opens, m toggles read, r refreshes.
   *
   * The keys only apply when the panel body has focus and no form control is
   * focused: typing in the search box or the category select must never
   * trigger a list action.
   */
  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target && typeof target.tagName === "string") {
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      if (target.isContentEditable) return;
    }
    const key = event.key;
    if (key === "j" || key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (key === "k" || key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (key === "Enter") {
      const row = view.rows[view.focusIndex];
      if (row) { event.preventDefault(); openRow(row); }
    } else if (key === "m") {
      const row = view.rows[view.focusIndex];
      if (row && row.key) { event.preventDefault(); toggleRead(row.key); }
    } else if (key === "r") {
      event.preventDefault();
      refreshNow();
    } else if (key === "?") {
      event.preventDefault();
      el.helpBtn.click();
    }
  }

  function moveFocus(delta) {
    if (view.rows.length === 0) return;
    const next = view.focusIndex < 0 ? 0 : view.focusIndex + delta;
    view.focusIndex = Math.max(0, Math.min(view.rows.length - 1, next));
    const target = el.list.children[view.focusIndex];
    if (target && target.firstElementChild) target.firstElementChild.focus();
    const row = view.rows[view.focusIndex];
    if (row) {
      ui.announce(el.status, row.title + ", " + (row.sourceTitle || "unknown source") +
        ", " + ui.relativeLabel(row.published, Date.now()));
    }
  }

  /* The panel reports its state for the DOM assertions in the boot proof. */
  globalThis.ZiyNewsPanel = {
    view: view,
    moveFocus: moveFocus,
    openRow: openRow,
    toggleRead: toggleRead,
    refreshNow: refreshNow,
    renderFeed: renderFeed,
    rows: function () { return view.rows; },
  };
})();
