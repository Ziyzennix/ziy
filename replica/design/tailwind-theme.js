/**
 * Ziy Tailwind theme mapping — the bridge between replica/design/tokens.json
 * and the extension suite's utility classes.
 *
 * HOW TO WIRE (the suite build will do this; do not add a root tailwind.config.js):
 *   tools/build-extension.sh generates the package root config as:
 *
 *     // tailwind.config.js  (generated — this file is the source of truth)
 *     const { theme, plugins } = require("./replica/design/tailwind-theme.js");
 *     module.exports = {
 *       content: ["./extensions/*\/ui/**\/*.{html,js,jsx,ts,tsx}"],
 *       theme,
 *       plugins,
 *     };
 *
 * Rules this file enforces:
 *  - Components use semantic roles (`bg-surface text-muted border-border`), never raw hex.
 *  - Light is the default scale; `dark:` resolves against the `-dark` suffixed roles,
 *    which are the same key names as the [data-theme="dark"] block in tokens.css.
 *  - `ziy` is the single prefix; `@ziy` paths are the NTP/sidebar content that runs
 *    outside the normal purge set, so content globs must include the extension UIs.
 */

const fs = require("fs");
const path = require("path");

/** Loads tokens.json once; throws loudly so the build cannot silently drift. */
function loadTokens() {
  const file = path.join(__dirname, "tokens.json");
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw);
}

const tokens = loadTokens();
// Hyphenated token keys are bound once so the mappings below stay readable.
const tabStrip = tokens[`browser-chrome`][`tab-strip`];
const ntp = tokens[`browser-chrome`].ntp;

/** Flattens {"color": {"dark": {"bg": "#..."}}} -> {"bg": "#...", "bg-dark": "#..."}. */
function flattenColors(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const name = prefix ? `${prefix}-${key}` : key;
    if (typeof value === "string" && value.startsWith("#")) out[name] = value;
    else if (typeof value === "object" && value) flattenColors(value, name, out);
  }
  return out;
}

const color = flattenColors(tokens.color);

/** Screens use the same steps as the 4/8 spacing base in tokens.json. */
const spacing = {
  0: tokens.space[0] + "px",
  1: tokens.space[1] + "px",
  2: tokens.space[2] + "px",
  3: tokens.space[3] + "px",
  4: tokens.space[4] + "px",
  5: tokens.space[5] + "px",
  6: tokens.space[6] + "px",
  7: tokens.space[7] + "px",
  8: tokens.space[8] + "px",
};

const fontSize = Object.fromEntries(
  Object.entries(tokens.type).map(([name, t]) => [
    name,
    [`${t.size}px`, { lineHeight: `${t.line}px`, fontWeight: String(t.weight) }],
  ])
);

const borderRadius = {
  sm: `${tokens.radius.sm}px`,
  md: `${tokens.radius.md}px`,
  lg: `${tokens.radius.lg}px`,
  pill: `${tokens.radius.pill}px`,
};

const boxShadow = {
  card: tokens.shadow.card,
  pop: tokens.shadow.pop,
};

const transitionDuration = {
  fast: tokens.motion.fast,
  base: tokens.motion.base,
};

const transitionTimingFunction = { ease: tokens.motion.ease };

const maxWidth = {
  content: `${tokens.layout["content-max"]}px`,
  nav: `${tokens.layout["nav-width"]}px`,
  "side-panel": `${tokens.layout["side-panel-width"]}px`,
};

const height = {
  toolbar: `${tokens.layout["toolbar-height"]}px`,
  "tab-strip": `${tabStrip.height}px`,
  "find-bar": `${tokens.layout["find-bar-height"]}px`,
  "side-rail": `${tokens.layout["side-rail-width"]}px`,
  "ntp-search": `${ntp[`search-height`]}px`,
};

const width = {
  nav: `${tokens.layout["nav-width"]}px`,
  "side-rail": `${tokens.layout["side-rail-width"]}px`,
  "side-panel": `${tokens.layout["side-panel-width"]}px`,
  tab: `${tabStrip[`tab-min-width`]}px`,
};

/** Class names the suite uses that must map to tokens, spelled out once. */
const theme = {
  extend: {
    colors: {
      ...color,
      // explicit aliases so `text-focus`, `bg-on-accent` etc. exist verbatim
      "on-accent": color["on-accent"],
      "on-accent-dark": color["on-accent-dark"],
      "on-danger": color["on-danger"],
      "on-danger-dark": color["on-danger-dark"],
    },
    fontFamily: {
      sans: tokens.font.sans.split(",").map((s) => s.trim()),
      mono: tokens.font.mono.split(",").map((s) => s.trim()),
    },
    fontSize,
    spacing,
    borderRadius,
    boxShadow,
    transitionDuration,
    transitionTimingFunction,
    maxWidth,
    height,
    width,
    screens: {
      sm: `${tokens.layout.breakpoints.sm}px`,
      md: `${tokens.layout.breakpoints.md}px`,
      lg: `${tokens.layout.breakpoints.lg}px`,
    },
  },
};

/**
 * One plugin, three jobs the suite repeats everywhere:
 *  - .ziy-frost        frosted NTP widget fill (light/dark aware)
 *  - .ziy-scroll       thin scrollbars for sidebar + chat
 *  - .ziy-tab-strip    chrome-accent-bar underline on the active tab strip
 * Keeps raw CSS out of components; every value comes from a token.
 */
const plugins = [
  function ziyTokens({ addBase, addComponents, theme: t }) {
    addBase({
      ":root": { colorScheme: "light" },
      '[data-theme="dark"]': { colorScheme: "dark" },
    });
    addComponents({
      ".ziy-frost": {
        backgroundColor: t("colors.bg") === "#ffffff" ? "rgba(255,255,255,.72)" : "rgba(23,24,26,.72)",
        backdropFilter: "blur(12px) saturate(140%)",
        WebkitBackdropFilter: "blur(12px) saturate(140%)",
        border: `1px solid ${t("colors.border")}`,
        borderRadius: t("borderRadius.lg"),
      },
      ".ziy-scroll": {
        scrollbarWidth: "thin",
        scrollbarColor: `${t("colors.border-strong")} transparent`,
        "&::-webkit-scrollbar": { width: "8px", height: "8px" },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: t("colors.border-strong"),
          borderRadius: t("borderRadius.pill"),
        },
      },
      ".ziy-chrome-bar": {
        borderTop: `${tokens.layout["chrome-accent-bar"]}px solid ${t("colors.accent")}`,
      },
    });
  },
];

module.exports = { theme, plugins, tokens, color };
