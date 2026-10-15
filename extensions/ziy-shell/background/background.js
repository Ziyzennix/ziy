/* Ziy shell extension — background event page.
 *
 * What the shell extension is for:
 *   1. apply the product theme via the theme API (background/theme.js), so the
 *      browser chrome is Ziy-branded from the first frame;
 *   2. open the first-run welcome page on install;
 *   3. hold the settings other modules read (shared bus, architecture.md §3.1).
 *
 * NOTE ON THE THEME MECHANISM: this extension does NOT use the manifest `theme`
 * key, and READ THE FILE AT background/theme.js before changing that — an
 * extension manifest that carries `theme` is validated against ThemeManifest,
 * which forbids `background`/`permissions`, and the app-dir installer rejects
 * the whole add-on. The theme API is the supported way to theme from an
 * extension (MDN: theme.update()).
 */

/* The theme API, published on ZiyShellTheme by background/theme.js, which the
   manifest loads ahead of this file in the same classic-script scope. Nothing
   here imports it as a module: a static `import` in a classic background
   script is a SyntaxError that discards the whole event page, and with it the
   first-run welcome tab (defect D-1). */
const { applyTheme } = globalThis.ZiyShellTheme;

const WELCOME_PAGE = "ui/welcome.html";
const SETTINGS_KEY = "ziy.shell.settings";
const DEFAULT_THEME = "system";

/* The saved choice: {engine, theme}. The theme role is what this file reads. */
function readSettings() {
  return browser.storage.local.get(SETTINGS_KEY).then((stored) => (stored && stored[SETTINGS_KEY]) || {});
}

/* First-run. onInstalled fires once per install and per update with
   details.reason — we only open the page for a fresh install, so an update
   never interrupts the user mid-session. */
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  browser.tabs.create({ url: browser.runtime.getURL(WELCOME_PAGE) }).catch(() => {
    /* A browser can refuse a tab create (no window yet during startup). The
       page is reachable from about:addons, so failing quietly is correct. */
  });
});

/* Apply the theme at every start and whenever the OS scheme changes while the
   user has chosen "Match my system". */
function applySavedTheme() {
  readSettings()
    .then((settings) => applyTheme(settings["ziy.shell.theme"] || DEFAULT_THEME))
    .catch(() => applyTheme(DEFAULT_THEME));
}

applySavedTheme();

browser.runtime.onStartup.addListener(applySavedTheme);

browser.storage.local.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) {
    applySavedTheme();
  }
});

const systemQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
if (systemQuery) {
  systemQuery.addEventListener("change", applySavedTheme);
}

/* The settings bus. Ask for the current settings and get a plain object;
   unknown keys come back absent, which every caller already tolerates. */
browser.runtime.onMessage.addListener((message) => {
  if (message && message.op === "ziy-shell.settings.get") {
    return readSettings().then((settings) => ({ ok: true, settings }));
  }
  return undefined;
});

/* The welcome page asks the background to re-read the theme immediately after
   the user saves, so a saved choice lands without waiting for storage change
   propagation. */
browser.runtime.onMessage.addListener((message) => {
  if (message && message.op === "ziy-shell.theme.apply") {
    return applyTheme(message.theme || DEFAULT_THEME);
  }
  return undefined;
});
