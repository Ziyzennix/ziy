/* Ziy news — the options page: source management.
 *
 * This page owns the source list: add by URL, enable/disable, category,
 * remove, reset to the starter set, and OPML import/export. It also owns the
 * two behaviour settings (open-links-where, the age window) that are part of
 * S42's state.
 *
 * The fetch itself is not here, on purpose: an options PAGE cannot fetch
 * cross-origin (its fetches are subject to CORS), and the grant belongs to
 * the background page. So "add this source" sends the URL to the event page,
 * which fetches it immediately and reports the result.
 *
 * The permission paragraph below is not decoration. host_permissions
 * <all_urls> is a wide grant for a feature whose whole job is reading URLs
 * the user pasted; the user is told why it is there in plain words, in the
 * page, at install time.
 */
(function () {
  "use strict";

  const ui = globalThis.ZiyNewsUi;

  const state = {
    sources: [],
    settings: null,
    busy: false,
    lastImport: null,
  };

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    cache();
    bind();
    load();
  });

  const el = {};
  function cache() {
    el.form = ui.byId("source-form");
    el.url = ui.byId("source-url");
    el.category = ui.byId("source-category");
    el.title = ui.byId("source-title");
    el.list = ui.byId("source-list");
    el.status = ui.byId("options-status");
    el.empty = ui.byId("source-empty");
    el.exportBtn = ui.byId("opml-export");
    el.importFile = ui.byId("opml-import");
    el.importBtn = ui.byId("opml-import-btn");
    el.resetBtn = ui.byId("sources-reset");
    el.openLinks = ui.byId("setting-open-links");
    el.windowSelect = ui.byId("setting-window");
    el.imagesToggle = ui.byId("setting-images");
  }

  function bind() {
    /* Adding by URL. The form is a real <form> with a submit handler, so the
     * browser's own validation and Enter-to-submit both work. */
    el.form.addEventListener("submit", function (event) {
      event.preventDefault();
      addSource();
    });
    el.exportBtn.addEventListener("click", exportOpml);
    el.importBtn.addEventListener("click", function () { el.importFile.click(); });
    el.importFile.addEventListener("change", importOpml);
    el.resetBtn.addEventListener("click", resetSources);

    /* The two settings write straight through; the background re-arms the
     * alarm when the interval changes, so a settings change takes effect now
     * rather than at the next refresh. */
    el.openLinks.addEventListener("change", function () {
      setSettings({ openLinksInNewTab: el.openLinks.value === "newtab" });
    });
    el.windowSelect.addEventListener("change", function () {
      setSettings({ windowHours: parseInt(el.windowSelect.value, 10) });
    });
    el.imagesToggle.addEventListener("change", function () {
      setSettings({ showImages: el.imagesToggle.checked });
    });
  }

  async function load() {
    try {
      const [sources, settings] = await Promise.all([
        ui.op("feed.sources.get"),
        ui.op("feed.settings.get"),
      ]);
      state.sources = sources.sources;
      state.settings = settings.settings;
      renderSettings();
      renderSources();
    } catch (err) {
      ui.announce(el.status, "Could not load your sources: " + (err.message || "unknown"));
    }
  }

  /* --------------------------------------------------------------------- */
  /* Settings.                                                            */
  /* --------------------------------------------------------------------- */

  function renderSettings() {
    el.openLinks.value = state.settings.openLinksInNewTab ? "newtab" : "current";
    el.windowSelect.value = String(state.settings.windowHours);
    el.imagesToggle.checked = state.settings.showImages;
  }

  async function setSettings(patch) {
    try {
      const result = await ui.op("feed.settings.set", { patch: patch });
      state.settings = result.settings;
      renderSettings();
      ui.announce(el.status, "Settings saved.");
    } catch (err) {
      ui.announce(el.status, "Could not save that setting: " + (err.message || "unknown"));
    }
  }

  /* --------------------------------------------------------------------- */
  /* Sources.                                                             */
  /* --------------------------------------------------------------------- */

  async function addSource() {
    const url = el.url.value.trim();
    if (!url) return;
    const category = el.category.value.trim() || "Uncategorised";
    const title = el.title.value.trim();
    el.form.setAttribute("aria-busy", "true");
    ui.announce(el.status, "Adding that source and fetching it now…");
    try {
      const result = await ui.op("feed.sources.add", {
        source: { url: url, category: category, title: title },
      });
      state.sources = result.sources;
      el.url.value = "";
      el.title.value = "";
      ui.announce(el.status, result.replaced
        ? "That source was already in your list; it is switched back on."
        : "Added. The first fetch is running now.");
      renderSources();
    } catch (err) {
      ui.announce(el.status, "Could not add that source: " + (err.message || "unknown"));
    } finally {
      el.form.removeAttribute("aria-busy");
    }
  }

  async function setEnabled(source, enabled) {
    try {
      const result = await ui.op("feed.sources.setEnabled", { id: source.id, enabled: enabled });
      state.sources = result.sources;
      renderSources();
      ui.announce(el.status, source.title + (enabled ? " is on." : " is off."));
    } catch (err) {
      ui.announce(el.status, "Could not change that source: " + (err.message || "unknown"));
    }
  }

  async function removeSource(source) {
    try {
      const result = await ui.op("feed.sources.remove", { id: source.id });
      state.sources = result.sources;
      renderSources();
      ui.announce(el.status, source.title + " removed.");
    } catch (err) {
      ui.announce(el.status, "Could not remove that source: " + (err.message || "unknown"));
    }
  }

  async function setCategory(source, category) {
    try {
      const result = await ui.op("feed.sources.setCategory", { id: source.id, category: category });
      state.sources = result.sources;
      renderSources();
    } catch (err) {
      ui.announce(el.status, "Could not file that source: " + (err.message || "unknown"));
    }
  }

  async function resetSources() {
    try {
      const result = await ui.op("feed.sources.reset");
      state.sources = result.sources;
      renderSources();
      ui.announce(el.status, "Your starter set is back. Fetches are running.");
    } catch (err) {
      ui.announce(el.status, "Could not restore the starter set: " + (err.message || "unknown"));
    }
  }

  /* --------------------------------------------------------------------- */
  /* OPML.                                                                */
  /* --------------------------------------------------------------------- */

  async function exportOpml() {
    try {
      const result = await ui.op("feed.opml.export");
      const blob = new Blob([result.opml], { type: "text/x-opml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = ui.el("a", { href: url, download: result.filename || "ziy-news.opml" });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      ui.announce(el.status, result.counts.total + " sources written to " + result.filename);
    } catch (err) {
      ui.announce(el.status, "Could not write the OPML file: " + (err.message || "unknown"));
    }
  }

  async function importOpml() {
    const file = el.importFile.files && el.importFile.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const result = await ui.op("feed.opml.import", { opml: text });
      state.sources = result.sources;
      state.lastImport = result;
      renderSources();
      const parts = [result.added + " added"];
      if (result.replaced > 0) parts.push(result.replaced + " already followed, updated");
      if (result.skipped && result.skipped.length > 0) {
        parts.push(result.skipped.length + " skipped");
      }
      ui.announce(el.status, "OPML read: " + parts.join(", ") + ".");
    } catch (err) {
      ui.announce(el.status, "Could not read that OPML: " + (err.message || "unknown"));
    } finally {
      el.importFile.value = "";
    }
  }

  /* --------------------------------------------------------------------- */
  /* Rendering.                                                           */
  /* --------------------------------------------------------------------- */

  function renderSources() {
    el.list.textContent = "";
    if (state.sources.length === 0) {
      el.empty.hidden = false;
      return;
    }
    el.empty.hidden = true;

    /* Grouped by category, newest sources last, so a user who just added a
     * feed finds it where they filed it. */
    const byCategory = new Map();
    for (const source of state.sources) {
      const key = source.category || "Uncategorised";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(source);
    }

    for (const category of Array.from(byCategory.keys()).sort()) {
      const group = ui.el("section", { class: "source-group" });
      group.appendChild(ui.el("h2", {
        class: "source-group__title",
        text: category + " (" + byCategory.get(category).length + ")",
      }));
      const rows = ui.el("ul", { class: "source-group__list", role: "list" });
      for (const source of byCategory.get(category).sort(byTitle)) {
        rows.appendChild(renderSourceRow(source));
      }
      group.appendChild(rows);
      el.list.appendChild(group);
    }
  }

  function byTitle(a, b) {
    return String(a.title || "").localeCompare(String(b.title || ""));
  }

  function renderSourceRow(source) {
    const host = ui.hostOf(source.url);
    const faviconHost = source.siteUrl ? ui.hostOf(source.siteUrl) : host;
    /* The favicon comes from the source's own site over https, which is the
     * only network this page makes and the only image it shows. A failure
     * leaves the initial, which is a real fallback rather than a broken icon. */
    const mark = ui.el("span", {
      class: "source-row__mark",
      dataset: { initial: String(source.title || "?").slice(0, 1).toUpperCase() },
      "aria-hidden": "true",
      text: String(source.title || "?").slice(0, 1).toUpperCase(),
    });
    if (faviconHost) {
      const img = ui.el("img", {
        class: "source-row__favicon",
        src: "https://www.google.com/s2/favicons?sz=32&domain=" + encodeURIComponent(faviconHost),
        alt: "",
        width: "16",
        height: "16",
        loading: "lazy",
      });
      img.addEventListener("error", function () { img.remove(); });
      mark.insertBefore(img, mark.firstChild);
    }

    const name = ui.el("div", { class: "source-row__text" });
    name.appendChild(ui.el("p", { class: "source-row__title", text: source.title }));
    name.appendChild(ui.el("p", { class: "source-row__url", text: source.url }));

    /* The per-source error, in words. This is the state that the reference
     * hides and that our users would otherwise have to guess at. */
    if (source.lastError) {
      name.appendChild(ui.el("p", {
        class: "source-row__error",
        text: messageForError(source.lastError.kind, source.lastError.message),
      }));
    }

    const categoryField = ui.el("label", { class: "source-row__category" });
    categoryField.appendChild(ui.el("span", { class: "visually-hidden", text: "Channel for " + source.title }));
    const select = ui.el("select", {
      class: "news-select news-select--compact",
      onchange: function () { setCategory(source, select.value); },
    });
    for (const option of ["World", "Technology", "Science", "Following", "Uncategorised"]) {
      select.appendChild(ui.el("option", {
        value: option,
        text: option,
        selected: source.category === option ? "" : null,
      }));
    }
    categoryField.appendChild(select);

    const toggle = ui.el("input", {
      class: "source-row__toggle",
      type: "checkbox",
      checked: source.enabled !== false ? "" : null,
      onchange: function () { setEnabled(source, toggle.checked); },
    });
    const toggleLabel = ui.el("label", { class: "source-row__toggle-label" });
    toggleLabel.appendChild(ui.el("span", {
      class: "visually-hidden",
      text: "Follow " + source.title,
    }));
    toggleLabel.appendChild(toggle);

    const remove = ui.el("button", {
      class: "news-btn news-btn--quiet news-btn--danger",
      type: "button",
      onclick: function () { removeSource(source); },
    }, ["Remove"]);

    return ui.el("li", { class: "source-row" }, [
      mark,
      name,
      categoryField,
      toggleLabel,
      remove,
    ]);
  }

  function messageForError(kind, message) {
    const map = {
      gone: "This feed is gone (404). Remove it or correct the URL.",
      forbidden: "This site refused the request (403).",
      "rate-limited": "This site asked us to slow down (429). Longer waits from here.",
      "server-error": "This site had a server error. Retrying with a longer wait.",
      timeout: "This feed did not answer in time.",
      empty: "This feed answered with an empty body.",
      "no-response": "This feed returned nothing.",
      offline: "There was no network.",
    };
    return map[kind] || message || "This feed is failing.";
  }

  /* Exposed for the DOM assertions in the boot proof. */
  globalThis.ZiyNewsOptions = {
    state: state,
    renderSources: renderSources,
    addSource: addSource,
    setEnabled: setEnabled,
    removeSource: removeSource,
    exportOpml: exportOpml,
    importOpml: importOpml,
    messageForError: messageForError,
  };
})();
