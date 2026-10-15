/* Ziy's static theme roles, applied through the theme API.
 *
 * WHY NOT THE `theme` MANIFEST KEY: on Gecko a manifest with a `theme` key is
 * parsed against `manifest.ThemeManifest`, which does NOT allow `background`,
 * `permissions`, `options_page` or any other extension key
 * (chrome/toolkit/content/extensions/schemas/theme.json inside omni.ja). An
 * extension that carries both the theme key and a background script fails
 * manifest normalization ("Extension is invalid") and the app-dir installer
 * then refuses it — verified on this machine: the same extension with the
 * `theme` key removed installs immediately, and with it present installs not
 * at all. MDN documents the supported shape: to include a theme in an
 * extension, define it as a theme.Theme object and apply it with theme.update()
 * (https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/theme).
 *
 * The values below are the same roles as manifest theme keys (theme.color
 * roles: frame, toolbar, tab_background_text, ntp_background, sidebar, ...),
 * sourced from replica/design/tokens.json — never hard-coded in more than one
 * place. images.theme_frame anchors the Ziy wordmark to the header.
 *
 * theme.update() is governed by the "theme" permission, which the manifest
 * requests, and can be reset with theme.reset().
 */

/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md section 2)
 *
 * This file is loaded as a classic <script> in the shared global scope of
 * the ziy-shell event page, ahead of background/background.js in the
 * manifest's background.scripts array. It therefore declares NOTHING at
 * the top level: THEME_LIGHT, THEME_DARK, systemWantsDark and applyTheme
 * all live inside the factory below. A static `import` in background.js
 * used to pull this file's exports in and was a SyntaxError that discarded
 * the whole event page -- defect D-1 in replica/test-report.md, the F01
 * welcome tab never opened. The classic-scope contract replaces it.
 *
 * The API is published on the one `ZiyShellTheme` global this extension's
 * classic scripts share, and on module.exports for a node consumer.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.THEME_LIGHT = api.THEME_LIGHT;
    exports.THEME_DARK = api.THEME_DARK;
    exports.systemWantsDark = api.systemWantsDark;
    exports.applyTheme = api.applyTheme;
  } else {
    root.ZiyShellTheme = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

const THEME_LIGHT = {
  images: {
    theme_frame: "icons/wordmark.svg"
  },
  colors: {
    frame: "#0b6e6e",
    frame_inactive: "#08504f",
    tab_background_text: "#ffffff",
    tab_text: "#ffffff",
    tab_selected: "#ffffff",
    toolbar: "#fafafb",
    toolbar_text: "#202124",
    bookmark_text: "#202124",
    icons: "#0b6e6e",
    icons_attention: "#8a5a00",
    toolbar_field: "#f0f0f0",
    toolbar_field_text: "#202124",
    toolbar_field_border: "#c9c9ca",
    toolbar_field_focus: "#ffffff",
    toolbar_field_text_focus: "#202124",
    toolbar_field_border_focus: "#0b6e6e",
    button_background_hover: "#e6f2f2",
    button_background_active: "#d5ebeb",
    popup: "#ffffff",
    popup_text: "#202124",
    popup_border: "#e4e4e5",
    popup_highlight: "#e6f2f2",
    popup_highlight_text: "#0b6e6e",
    ntp_background: "#ffffff",
    ntp_card_background: "#fafafb",
    ntp_text: "#202124",
    sidebar: "#fafafb",
    sidebar_border: "#e4e4e5",
    sidebar_text: "#202124",
    sidebar_highlight: "#e6f2f2",
    sidebar_highlight_text: "#0b6e6e"
  },
  properties: {
    color_scheme: "light",
    content_color_scheme: "light"
  }
};

const THEME_DARK = {
  images: {
    theme_frame: "icons/wordmark.svg"
  },
  colors: {
    frame: "#17181a",
    frame_inactive: "#101113",
    tab_background_text: "#f4f5f6",
    tab_text: "#f4f5f6",
    tab_selected: "#26282b",
    toolbar: "#1f2124",
    toolbar_text: "#f4f5f6",
    bookmark_text: "#f4f5f6",
    icons: "#2dd4bf",
    icons_attention: "#fbbf24",
    toolbar_field: "#101113",
    toolbar_field_text: "#f4f5f6",
    toolbar_field_border: "#3a3d41",
    toolbar_field_focus: "#26282b",
    toolbar_field_text_focus: "#f4f5f6",
    toolbar_field_border_focus: "#2dd4bf",
    button_background_hover: "#26282b",
    button_background_active: "#14302e",
    popup: "#26282b",
    popup_text: "#f4f5f6",
    popup_border: "#3a3d41",
    popup_highlight: "#14302e",
    popup_highlight_text: "#5ee0d0",
    ntp_background: "#17181a",
    ntp_card_background: "#1f2124",
    ntp_text: "#f4f5f6",
    sidebar: "#1f2124",
    sidebar_border: "#3a3d41",
    sidebar_text: "#f4f5f6",
    sidebar_highlight: "#14302e",
    sidebar_highlight_text: "#5ee0d0"
  },
  properties: {
    color_scheme: "dark",
    content_color_scheme: "dark"
  }
};

/* The user's choice from the welcome page, or the system scheme. */
function systemWantsDark() {
  const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  return query ? query.matches : false;
}

/* theme.update() is a write to the theme service; it is safe to call on every
   startup because the current theme is fully replaced each time. */
function applyTheme(preference) {
  const dark =
    preference === "dark" || (preference !== "light" && systemWantsDark());
  return browser.theme
    .update(dark ? THEME_DARK : THEME_LIGHT)
    .catch(() => {
      /* A user who revokes the "theme" permission in about:addons gets here.
         Ziy still boots: the theme is a skin, not a feature gate. */
    });
}

  return {
    THEME_LIGHT,
    THEME_DARK,
    systemWantsDark,
    applyTheme,
  };
});
