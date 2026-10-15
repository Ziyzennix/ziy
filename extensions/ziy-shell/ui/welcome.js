/* Ziy shell extension — the first-run welcome page.
 *
 * The product's first contact with the user (recon S01 / F01). Brave's tour
 * imports data first; Ziy's own import flow is later work, so this page asks
 * for the two choices the recon records as first-run decisions that are Ziy's
 * own to make: the default search engine and the theme.
 *
 * Choices are persisted via browser.storage.local under `ziy.shell.*` so every
 * other module (the NTP, the settings page) reads one shared key, per
 * architecture.md §3.1. Nothing is sent anywhere: this page makes no network
 * request at all, which is the point of a privacy-first browser's first screen.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "ziy.shell.settings";

  /* The engines Ziy ships with. Names are Ziy's own labels; these are the
     defaults the shell seeds, not a claim about what any engine does. Google
     is the first entry and the default — it is one option among many in the
     catalog, and every other engine here stays selectable. */
  const ENGINES = [
    { id: "google", label: "Google", hint: "The search most people expect" },
    { id: "duckduckgo", label: "DuckDuckGo", hint: "No logs, no profile" },
    { id: "startpage", label: "Startpage", hint: "Google results, proxy-served" },
    { id: "marginalia", label: "Marginalia", hint: "The small web" },
    { id: "custom", label: "Bring your own", hint: "A search URL you supply yourself" }
  ];

  const THEMES = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "Match my system" }
  ];

  const form = document.getElementById("welcome-form");
  const engineFieldset = document.getElementById("engine-field");
  const customEngineRow = document.getElementById("custom-engine-row");
  const customEngineInput = document.getElementById("custom-engine");
  const themeFieldset = document.getElementById("theme-field");
  const status = document.getElementById("form-status");

  /* --- form control construction -------------------------------------------
     Real form semantics: one <fieldset> with <legend> per question, radios in
     the fieldset. Keyboard behaviour comes from the platform when the DOM is
     right, which is why the radios are real radios and not divs. */

  function buildRadios(host, options, name) {
    options.forEach((option, index) => {
      const wrap = document.createElement("label");
      wrap.className = "option";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = option.id;
      input.id = `${name}-${option.id}`;
      if (index === 0) input.checked = true;

      const text = document.createElement("span");
      text.className = "option-text";
      const label = document.createElement("span");
      label.className = "option-label";
      label.textContent = option.label;
      text.appendChild(label);
      if (option.hint) {
        const hint = document.createElement("span");
        hint.className = "option-hint";
        hint.textContent = option.hint;
        text.appendChild(hint);
      }

      wrap.appendChild(input);
      wrap.appendChild(text);
      host.appendChild(wrap);
    });
  }

  buildRadios(engineFieldset.querySelector(".options"), ENGINES, "engine");
  buildRadios(themeFieldset.querySelector(".options"), THEMES, "theme");

  /* "Bring your own" is the only engine that needs another value; hide its row
     until it is picked, and focus the field when it appears. */
  function syncCustomEngine() {
    const picked = form.querySelector('input[name="engine"]:checked');
    const show = picked && picked.value === "custom";
    customEngineRow.hidden = !show;
    if (show) customEngineInput.focus();
  }
  form.addEventListener("change", (event) => {
    if (event.target.name === "engine") syncCustomEngine();
  });

  /* --- read the current choice so a second visit is pre-filled ------------- */
  browser.storage.local
    .get(STORAGE_KEY)
    .then((stored) => {
      const settings = (stored && stored[STORAGE_KEY]) || {};
      const engine = document.getElementById(
        `engine-${settings["ziy.search.engine"] || "google"}`,
      );
      if (engine) engine.checked = true;
      const theme = document.getElementById(`theme-${settings["ziy.shell.theme"] || "system"}`);
      if (theme) theme.checked = true;
      if (settings["ziy.search.engine"] === "custom" && settings["ziy.search.engine.custom"]) {
        customEngineInput.value = settings["ziy.search.engine.custom"];
      }
      syncCustomEngine();
    })
    .catch(() => {
      /* Storage can be unavailable in a throwaway profile. The form defaults
         are still correct, so this is not a failure the user needs to see. */
    });

  /* --- live theme preview ---------------------------------------------------- */
  function applyPreviewTheme() {
    const picked = form.querySelector('input[name="theme"]:checked');
    const value = picked ? picked.value : "system";
    const wantsDark =
      value === "dark" ||
      (value === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", wantsDark ? "dark" : "light");
  }
  form.addEventListener("change", applyPreviewTheme);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const picked = form.querySelector('input[name="theme"]:checked');
    if (picked && picked.value === "system") applyPreviewTheme();
  });
  applyPreviewTheme();

  /* --- save ------------------------------------------------------------------ */
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const enginePicked = form.querySelector('input[name="engine"]:checked');
    const themePicked = form.querySelector('input[name="theme"]:checked');
    if (!enginePicked || !themePicked) return;

    const engineId = enginePicked.value;
    if (engineId === "custom" && !customEngineInput.value.trim()) {
      status.textContent = "A search URL is needed before Ziy can use it.";
      status.setAttribute("role", "alert");
      customEngineInput.focus();
      return;
    }

    const settings = {
      "ziy.search.engine": engineId,
      "ziy.shell.theme": themePicked.value
    };
    if (engineId === "custom") {
      settings["ziy.search.engine.custom"] = customEngineInput.value.trim();
    }

    status.textContent = "Saved. Your new tab opens next.";
    browser.storage.local
      .set({ [STORAGE_KEY]: settings })
      .then(() => browser.runtime.sendMessage({
        op: "ziy-shell.theme.apply",
        theme: settings["ziy.shell.theme"]
      }))
      .then(() => browser.tabs.create({ url: browser.runtime.getURL("ui/done.html") }))
      .then(() => window.close())
      .catch(() => {
        status.textContent = "Ziy could not save that. Try again.";
        status.setAttribute("role", "alert");
      });
  });

  /* The mark names the cat itself now — it is the app icon, not decoration. */
})();
