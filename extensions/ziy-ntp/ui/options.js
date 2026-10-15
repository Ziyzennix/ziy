/* Ziy NTP — the settings page (about:addons → Preferences).
 *
 * The same widget toggles the customize dashboard has, plus the engine checkbox
 * list the NTP has no room for. Every write goes through lib/storage.js, so the
 * options page, the dashboard and the new tab page cannot disagree.
 */
(function () {
  "use strict";

  const model = ZiyNtpModel;
  const store = ZiyNtpStorage;

  const $ = function (id) { return document.getElementById(id); };

  const el = {
    widgetToggles: $("widget-toggles"),
    engineList: $("engine-list"),
    engineStatus: $("engine-status"),
    clockChoice: $("clock-choice"),
    backgroundChoice: $("background-choice"),
    gradientSwatches: $("gradient-swatches"),
    customFileRow: $("custom-file-row"),
    customFile: $("custom-file"),
    customFileName: $("custom-file-name"),
    customRemove: $("custom-remove"),
    bgRefresh: $("bg-refresh"),
    backgroundStatus: $("background-status"),
    modeChoice: $("mode-choice"),
    modeHint: $("mode-hint"),
    cardsToggle: $("cards-toggle"),
    pageStatus: $("page-status"),
  };

  const view = {
    config: model.defaultConfig(),
    engines: [],
  };

  /* ------------------------------------------------------------------ helpers */

  function flash(node, text) {
    node.textContent = text;
    globalThis.setTimeout(function () {
      if (node.textContent === text) node.textContent = "";
    }, 2600);
  }

  function toggleRow(id, label, description, value, onChange) {
    const row = document.createElement("div");
    row.className = "toggle-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.id = "opt-" + id;
    input.checked = !!value;
    input.setAttribute("aria-describedby", "opt-desc-" + id);
    const text = document.createElement("span");
    text.className = "text";
    const labelEl = document.createElement("label");
    labelEl.setAttribute("for", input.id);
    labelEl.textContent = label;
    const desc = document.createElement("p");
    desc.className = "desc";
    desc.id = "opt-desc-" + id;
    desc.textContent = description || "";
    text.appendChild(labelEl);
    if (description) text.appendChild(desc);
    row.appendChild(input);
    row.appendChild(text);
    input.addEventListener("change", function () { onChange(input.checked, input); });
    return row;
  }

  /* ----------------------------------------------------------------- widgets */

  function renderWidgets() {
    const descriptions = {
      background: "The colour or picture behind the page.",
      search: "The search box and its engine switcher.",
      topsites: "Your shortcuts, and the mode that decides what fills them.",
      clock: "The time and date, and the 12 or 24-hour format.",
      stats: "How many requests Ziy has stopped for you.",
      news: "The stories Ziy News has collected in your window.",
    };
    el.widgetToggles.textContent = "";
    for (const widget of model.WIDGETS) {
      el.widgetToggles.appendChild(
        toggleRow(
          "widget-" + widget.id,
          widget.label,
          descriptions[widget.id],
          view.config.widgets[widget.id],
          function (checked) {
            store.setWidget(widget.id, checked).then(function (config) {
              view.config = config;
              renderWidgets();
            });
          },
        ),
      );
    }
    el.widgetToggles.appendChild(
      toggleRow(
        "widget-cards",
        "Cards",
        "A section for cards on the new tab page. Off until there is something to fill it with.",
        view.config.cards,
        function (checked) {
          store.setCards(checked).then(function (config) {
            view.config = config;
            renderWidgets();
          });
        },
      ),
    );

    el.cardsToggle.checked = !!view.config.cards;
  }

  /* ----------------------------------------------------------------- engines */

  async function loadEngines() {
    let available = null;
    const api = globalThis.browser || globalThis.chrome;
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
    if (!available) available = model.defaultEngines();
    const stored = await store.loadEngines();
    view.engines = model.mergeEngines(available, stored);
  }

  function renderEngines() {
    el.engineList.textContent = "";
    for (const engine of view.engines) {
      const row = document.createElement("div");
      row.className = "engine-row";
      row.dataset.engineId = engine.id;

      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = "engine-" + engine.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      input.checked = !!engine.checked;
      input.setAttribute("aria-describedby", "engine-desc-" + input.id);

      const text = document.createElement("span");
      text.className = "engine-text";

      const label = document.createElement("label");
      label.setAttribute("for", input.id);
      label.textContent = engine.name + (engine.isDefault ? " (the browser default)" : "");

      const desc = document.createElement("p");
      desc.className = "desc";
      desc.id = "engine-desc-" + input.id;
      if (engine.source === "browser") {
        desc.textContent =
          "One of the engines this browser already knows about. It is searched through the browser itself, so no address is needed here.";
      } else {
        desc.textContent = engine.urlTemplate || "Not configured yet.";
      }

      text.appendChild(label);
      text.appendChild(desc);

      /* The user's own provider slot is the only editable one. */
      if (engine.editable && engine.source === "own") {
        const url = document.createElement("input");
        url.type = "url";
        url.value = engine.urlTemplate || "";
        url.placeholder = "https://example.com/search?q={query}";
        url.setAttribute("aria-label", "Address for your own search provider");
        url.setAttribute("aria-describedby", "engine-err-" + input.id);
        url.addEventListener("change", function () {
          const value = url.value.trim();
          if (!value) {
            store.setEngineChecked(engine.id, false).then(renderAll);
            return;
          }
          const check = validateProviderUrl(value);
          if (!check.ok) {
            showEngineError("engine-err-" + input.id, check.error);
            return;
          }
          clearEngineError("engine-err-" + input.id);
          store
            .saveEngines(
              view.engines.map(function (e) {
                if (e.id !== engine.id) return { id: e.id, checked: e.checked };
                return { id: e.id, checked: e.checked };
              }),
            )
            .then(function () {
              /* Persist the template by pairing it with the checked state: the
                 choice list is the only thing the store owns, so the template is
                 written here alongside it. */
              return store.saveEngines(
                view.engines.map(function (e) {
                  if (e.id !== engine.id) return { id: e.id, checked: e.checked };
                  return { id: e.id, checked: e.checked, urlTemplate: check.url };
                }),
              );
            })
            .then(function () {
              flash(el.engineStatus, "Saved your own provider.");
              renderAll();
            });
        });
        const err = document.createElement("p");
        err.className = "error";
        err.id = "engine-err-" + input.id;
        err.setAttribute("role", "alert");
        err.hidden = true;
        text.appendChild(url);
        text.appendChild(err);
      }

      row.appendChild(input);
      row.appendChild(text);
      el.engineList.appendChild(row);

      input.addEventListener("change", function () {
        store.setEngineChecked(engine.id, input.checked).then(function () {
          flash(el.engineStatus, input.checked ? "Engine added to the list." : "Engine taken off the list.");
          renderEngines();
        });
      });
    }
  }

  function showEngineError(id, message) {
    const node = $(id);
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
  }

  function clearEngineError(id) {
    const node = $(id);
    if (!node) return;
    node.hidden = true;
    node.textContent = "";
  }

  /* The user's own provider must be a full https URL with the {query} token in
     it, or the search box would have nowhere to put the words. */
  function validateProviderUrl(value) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch (_err) {
      return { ok: false, error: "Give a full address, like https://example.com/search?q={query}." };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: "Only http and https addresses work here." };
    }
    if (value.indexOf("{query}") === -1) {
      return {
        ok: false,
        error: "The address needs {query} where the search words should go.",
      };
    }
    return { ok: true, url: value };
  }

  /* ----------------------------------------------------------------- clocks */

  function renderClockChoice() {
    el.clockChoice.textContent = "";
    for (const option of [
      { id: "24", label: "24-hour" },
      { id: "12", label: "12-hour" },
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.clock = option.id;
      button.textContent = option.label;
      button.setAttribute("aria-checked", String((option.id === "24") === view.config.clock24h));
      button.addEventListener("click", function () {
        store.setClock24h(option.id === "24").then(function (config) {
          view.config = config;
          renderClockChoice();
        });
      });
      el.clockChoice.appendChild(button);
    }
  }

  /* ------------------------------------------------------------- background */

  function renderBackground() {
    el.backgroundChoice.textContent = "";
    for (const source of model.BACKGROUND_SOURCES) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.source = source.id;
      button.textContent = source.label;
      button.setAttribute("aria-checked", String(view.config.background.source === source.id));
      button.addEventListener("click", function () {
        store.setBackground({ source: source.id }).then(function (config) {
          view.config = config;
          renderBackground();
        });
      });
      el.backgroundChoice.appendChild(button);
    }

    el.gradientSwatches.textContent = "";
    for (const gradient of model.GRADIENTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.dataset.gradientId = gradient.id;
      button.style.backgroundImage = gradient.css;
      button.setAttribute("aria-pressed", String(view.config.background.gradientId === gradient.id));
      button.setAttribute("aria-label", "Use the " + gradient.label + " backdrop");
      button.addEventListener("click", function () {
        store.setBackground({ source: "gradient", gradientId: gradient.id }).then(function (config) {
          view.config = config;
          renderBackground();
        });
      });
      el.gradientSwatches.appendChild(button);
    }

    el.customFileRow.hidden = view.config.background.source !== "custom";
    el.customFileName.textContent = view.config.background.customName || "";
    el.bgRefresh.checked = !!view.config.background.refreshOnNewTab;
  }

  /* ------------------------------------------------------------------ modes */

  function renderMode() {
    el.modeChoice.textContent = "";
    for (const mode of model.TOP_SITE_MODES) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.mode = mode;
      button.textContent = mode === "favorites" ? "Favorites" : "Frequently visited";
      button.setAttribute("aria-checked", String(view.config.topSitesMode === mode));
      button.addEventListener("click", function () {
        store.setTopSitesMode(mode).then(function (config) {
          view.config = config;
          renderMode();
        });
      });
      el.modeChoice.appendChild(button);
    }
    el.modeHint.textContent =
      view.config.topSitesMode === "frequent"
        ? "Frequently visited is filled in for you from the pages you visit most, one per site. Ziy does not let it be edited by hand."
        : "Favorites is your own list, up to 24 sites. You add, edit, remove and reorder them on the new tab page itself.";
  }

  /* ------------------------------------------------------------------- boot */

  function renderAll() {
    renderWidgets();
    renderEngines();
    renderClockChoice();
    renderBackground();
    renderMode();
  }

  function wire() {
    el.cardsToggle.addEventListener("change", function () {
      store.setCards(el.cardsToggle.checked).then(function (config) {
        view.config = config;
        renderWidgets();
      });
    });

    el.customFile.addEventListener("change", function () {
      const file = el.customFile.files && el.customFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        store
          .setCustomBackground(String(reader.result), file.name)
          .then(function (config) {
            view.config = config;
            renderBackground();
            flash(el.backgroundStatus, "Backdrop set to " + file.name + ".");
          });
      };
      reader.onerror = function () {
        flash(el.backgroundStatus, "That picture could not be read. Try another file.");
      };
      reader.readAsDataURL(file);
    });

    el.customRemove.addEventListener("click", function () {
      store
        .setBackground({ source: "gradient", customDataUrl: null, customName: null })
        .then(function (config) {
          view.config = config;
          renderBackground();
          flash(el.backgroundStatus, "Backdrop removed.");
        });
    });

    el.bgRefresh.addEventListener("change", function () {
      store.setBackground({ refreshOnNewTab: el.bgRefresh.checked }).then(function (config) {
        view.config = config;
      });
    });

    /* The engine list can change under us — the options page of another profile
       writing, or the browser adding an engine — so keep it live. */
    const api = globalThis.browser || globalThis.chrome;
    if (api && api.storage && api.storage.local && api.storage.local.onChanged) {
      api.storage.local.onChanged.addListener(function (changes, area) {
        if (area !== "local") return;
        if (!changes[model.STORAGE_KEYS.engines]) return;
        store.loadEngines().then(function () {
          loadEngines().then(function () {
            renderEngines();
          });
        });
      });
    }
  }

  async function load() {
    view.config = await store.loadConfig();
    await loadEngines();
    renderAll();
    void el.pageStatus;
  }

  wire();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }

  globalThis.ZiyNtpOptions = { renderAll, load, view };
})();
