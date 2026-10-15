/* Ziy shields — the Shields precedence resolver (replica/architecture.md §5.3).
 *
 * Resolution order for any decision on a request in a tab:
 *
 *   1. session override      (element blocker, "block element" for this page only)
 *   2. per-site override     shields.site.<domain>   (persisted, wins over global)
 *   3. sub-toggle override   the fp / cookie / script / https sub-toggles
 *   4. global default        shields.global
 *   5. factory default       (Standard mode, fp on, https upgrade auto)
 *
 * The two rules the recon is explicit about, both enforced here:
 *
 *  - A per-site override is stored as an ABSOLUTE rule and is never rewritten
 *    by a later global change. shields.site.<domain> holds a full ShieldRule,
 *    never a diff, so this resolver must not merge a stored per-site rule with
 *    the current global defaults to "fill in the gaps" — the stored rule is the
 *    whole truth for that site, and what is missing from it is the FACTORY
 *    default, not the global one.
 *  - The sub-toggles are tri-state (global|on|off) so "inherit" is
 *    representable. 'global' means "whatever the layer above says".
 *
 * This module is pure (no browser.* APIs) so the whole precedence matrix is a
 * unit test under plain node.
 */

/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md §2)
 *
 * Loaded as a classic <script> in the shared global scope of the event page,
 * next to the other ziy-shields lib files. Nothing is declared at the top
 * level here: the body lives inside the factory, so no name can collide with
 * a name another lib file owns (defect D-2, replica/test-report.md). The API
 * goes on the shared `ziyShields` namespace and on module.exports for the
 * unit tests.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  if (!root.ziyShields) root.ziyShields = {};
  const api = factory();
  Object.assign(root.ziyShields, api);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.FACTORY = api.FACTORY;
    exports.ROWS = api.ROWS;
    exports.FP_SUBTOGGLES = api.FP_SUBTOGGLES;
    exports.FP_TARGETS = api.FP_TARGETS;
    exports.compactRule = api.compactRule;
    exports.STORAGE_KEY_GLOBAL = api.STORAGE_KEY_GLOBAL;
    exports.STORAGE_KEY_LISTS = api.STORAGE_KEY_LISTS;
    exports.siteKey = api.siteKey;
    exports.isDomain = api.isDomain;
    exports.normaliseRule = api.normaliseRule;
    exports.normaliseTriState = api.normaliseTriState;
    exports.resolve = api.resolve;
    exports.serialiseGranularOverrides = api.serialiseGranularOverrides;
    exports.buildGranularOverride = api.buildGranularOverride;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

'use strict';


/* ------------------------------------------------------------------ *
 * The ShieldRule shape (recon's ShieldRule entity, architecture §3.2)
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} ShieldRule
 * @property {'standard'|'aggressive'|'off'} adsTrackers
 * @property {'auto'|'strict'|'off'}        httpsUpgrade
 * @property {'allow'|'block'}              scripts
 * @property {'block_3p'|'block_all'|'allow_all'} cookies
 * @property {boolean}                      fingerprinting
 * @property {'global'|'on'|'off'}          fpSub
 * @property {'global'|'on'|'off'}          fpCanvas
 * @property {'global'|'on'|'off'}          fpFonts
 * @property {'global'|'on'|'off'}          fpLocale
 * @property {'global'|'on'|'off'}          fpHardware
 * @property {'global'|'on'|'off'}          fpScreen
 * @property {'global'|'on'|'off'}          fpTimer
 * @property {boolean}                      forgetMeOnClose
 * @property {boolean}                      enabled
 */

/** The factory default. Layer 5 above. */
const FACTORY = Object.freeze({
  adsTrackers: 'standard',
  httpsUpgrade: 'auto',
  scripts: 'block',
  cookies: 'block_3p',
  fingerprinting: true,
  fpSub: 'global',
  fpCanvas: 'global',
  fpFonts: 'global',
  fpLocale: 'global',
  fpHardware: 'global',
  fpScreen: 'global',
  fpTimer: 'global',
  forgetMeOnClose: false,
  /* Spotify ad slots. Default ON, because the feature's whole point is the
   * default behaviour: block the ad audio AND let the song play. Tri-state
   * like the fingerprinting sub-toggles so per-site inheritance works
   * (replica/proofs-blocking-strength.md §5). */
  spotifyAdSlot: 'global',
  enabled: true,
});

/**
 * Sub-toggle keys that belong to the fingerprinting row — the 19 discrete
 * farbling targets recorded in replica/re-deep-shields.md §5, each a separate
 * content setting in the source and each mapped here to its own key.
 *
 * Ziy keeps its own key names (documented in lib/engine/alignment.js with the
 * source's setting names and each target's balanced/maximum behaviour) so the
 * resolver and the UI stay Ziy vocabulary; alignment.js is the mapping table.
 * `fpSentinel` is the source's "global default level" sentinel: it is not a
 * per-target toggle, so it never becomes a target string of its own.
 */
const FP_SUBTOGGLES = Object.freeze([
  'fpAudio', 'fpCanvas', 'fpDeviceMemory', 'fpEventSourcePool', 'fpFont',
  'fpHardware', 'fpKeyboard', 'fpLanguage', 'fpMediaDevices', 'fpPlugins',
  'fpScreen', 'fpSpeechSynthesis', 'fpUsbSerial', 'fpUserAgent', 'fpWebgl',
  'fpWebgl2', 'fpWebgpu', 'fpWebSocketsPool', 'fpSentinel',
]);
/** Every row the panel and the global settings page show, in display order. */
const ROWS = Object.freeze([
  // Row order follows replica/recon-behavior.md's OBSERVED global-settings
  // order: badge/Shields toggle (handled separately as `enabled`), Trackers &
  // ads, HTTPS upgrade, Scripts, Fingerprinting, Cookies, Forget-me.
  // The observed list's remaining entries are engine-coupled and are recorded
  // as documented variants, not rows: contact-info and
  // element-blocker-in-private toggles, the Content filtering link, and the
  // adblock-only-mode / social-blocking / adblock-filters subpages.
  { key: 'adsTrackers', label: 'Trackers and ads', kind: 'segmented',
    options: ['standard', 'aggressive', 'off'], defaultSource: 'factory' },
  { key: 'httpsUpgrade', label: 'Upgrade to HTTPS', kind: 'segmented',
    options: ['auto', 'strict', 'off'], defaultSource: 'factory' },
  { key: 'scripts', label: 'Scripts', kind: 'toggle', defaultSource: 'factory' },
  { key: 'fingerprinting', label: 'Block fingerprinting', kind: 'toggle',
    subToggles: FP_SUBTOGGLES, defaultSource: 'factory' },
  { key: 'cookies', label: 'Cookie control', kind: 'dropdown',
    options: ['block_3p', 'block_all', 'allow_all'], defaultSource: 'factory' },
  { key: 'forgetMeOnClose', label: 'Forget me when I close this site',
    kind: 'toggle', defaultSource: 'factory' },
  /* Ziy's own row, not in Brave's observed UI: block Spotify's ad AUDIO but
   * leave the player in a state where the song still follows. The naive block
   * leaves the web player stuck in the ad slot. See
   * replica/proofs-blocking-strength.md §5. */
  { key: 'spotifyAdSlot', label: 'Spotify ad slots: block the ad, keep the song',
    kind: 'toggle', triState: true, defaultSource: 'ziy',
    options: ['global', 'on', 'off'] },
]);

/* Rows not rendered, kept so the order above stays readable and so a later
 * variant has a place to live rather than a second convention:
 *   fingerprinting (above, compound: the 19-target sub-toggle list)
 *   forgetMeOnClose (above)
 */
const OBSERVED_VARIANT_ROWS = Object.freeze([
  { key: 'contactInfo', source: 'contact-info toggle in the observed settings UI',
    status: 'engine-coupled; not a filter-list row' },
  { key: 'elementBlockerInPrivate', source: 'element-blocker-in-private toggle',
    status: 'engine-coupled (private-window injection scope)' },
  { key: 'contentFilteringLink', source: 'Content filtering link -> the list page',
    status: 'a link, not a row; Ziy ships the Filter lists section' },
  { key: 'adblockOnlyMode', source: 'adblock-only-mode subpage',
    status: 'documented variant: ad blocking without the cosmetic layer' },
  { key: 'socialBlocking', source: 'social-blocking subpage',
    status: 'documented variant: a social-widget list toggle' },
  { key: 'adblockFilters', source: 'adblock filters subpage',
    status: 'documented variant: the list registry Ziy ships as Filter lists' },
]);




/**
 * The fingerprint targets each sub-toggle maps to, in RFPTargets.inc names.
 *
 * Single-sourced from alignment.js so the 19-target table has ONE definition:
 * a target the engine does not know (the source's EventSource/WebSocket pool
 * budgets, the USB serial) maps to null and is dropped from the target string
 * rather than written as a name FingerprintingWebCompatService would reject.
 */
/* alignment.js publishes FP_KEY_TO_TARGET on the shared namespace; the
 * manifest lists it ahead of this file, so the published table is used and
 * the literal below is only a fallback for a direct require() in tests. */
const FP_TARGETS = Object.freeze(
  (typeof globalThis !== 'undefined' && globalThis.ziyShields && globalThis.ziyShields.FP_KEY_TO_TARGET)
    ? globalThis.ziyShields.FP_KEY_TO_TARGET
    : {
        fpAudio: 'AudioChannel',
        fpCanvas: 'CanvasRandomization',
        fpDeviceMemory: 'JSLocaleNavigatorDeviceMemory',
        fpFont: 'FontVisibility',
        fpHardware: 'NavigatorHWConcurrency',
        fpKeyboard: 'NavigatorKeyboardLayout',
        fpLanguage: 'JSLocaleLocale',
        fpMediaDevices: 'NavigatorEnumerateMediaDevices',
        fpPlugins: 'NavigatorPlugins',
        fpScreen: 'ScreenRect',
        fpSpeechSynthesis: 'SpeechSynthesis',
        fpUserAgent: 'NavigatorUserAgent',
        fpWebgl: 'WebGLRenderInfo',
        fpWebgpu: 'WebGPUAdapterInfo',
      },
);

const TRI_STATE = new Set(['global', 'on', 'off']);

/* ------------------------------------------------------------------ *
 * Storage keys (architecture §3.2)
 * ------------------------------------------------------------------ */

const STORAGE_KEY_GLOBAL = 'shields.global';
const STORAGE_KEY_LISTS = 'shields.lists';

function siteKey(domain) {
  return `shields.site.${domain}`;
}

/* ------------------------------------------------------------------ *
 * Validation / normalisation
 * ------------------------------------------------------------------ */

function isDomain(d) {
  if (typeof d !== 'string' || d === '') return false;
  if (d === 'localhost') return true;
  // IPv4 loopback literals are accepted for the store shape, but they are not
  // subdomains of a public suffix, so callers must not use the public-suffix
  // path on them.
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(d)) {
    return d.split('.').every(part => Number(part) <= 255);
  }
  if (d.startsWith('[') || d.includes(':')) return false;     // IPv6: not supported here
  if (d.startsWith('.') || d.endsWith('.') || d.includes('..')) return false;
  if (/\s/.test(d)) return false;
  // Every label must start and end with a letter or digit; the TLD must be
  // letters only, and there must be at least one label before it.
  const labels = d.split('.');
  if (labels.length < 2) return false;
  if (!/^[A-Za-z]{2,}$/.test(labels[labels.length - 1])) return false;
  return labels.every(label => /^(?!-)[A-Za-z0-9-]{1,63}(?!-)$/.test(label));
}

function normaliseTriState(v) {
  if (v === true) return 'on';
  if (v === false) return 'off';
  if (v === 'on' || v === 'off') return v;
  if (v === 'global' || v === undefined || v === null) return 'global';
  return 'global';
}

/** Rows that are plain booleans rather than enums, in the rule record. */
const BOOLEAN_ROWS = Object.freeze(['fingerprinting', 'forgetMeOnClose', 'enabled']);

const ENUMS = {
  adsTrackers: ['standard', 'aggressive', 'off'],
  httpsUpgrade: ['auto', 'strict', 'off'],
  scripts: ['allow', 'block'],
  cookies: ['block_3p', 'block_all', 'allow_all'],
};

/** Every tri-state row: 'global' | 'on' | 'off'. The Spotify ad-slot row is
 *  tri-state for the same reason the fingerprinting sub-toggles are — a
 *  per-site override must be able to say "inherit" rather than pin a value. */
const TRI_STATE_ROWS = Object.freeze([
  ...FP_SUBTOGGLES,
  'fpSub',
  'spotifyAdSlot',
]);

/**
 * Normalises a partial rule into a full ShieldRule. Anything absent comes from
 * the FACTORY default — which is what makes a per-site override "absolute": the
 * stored record does not need to mention a row to have a defined value for it,
 * and that value never changes when the global default changes.
 *
 * IMPORTANT: this EXPANSION is the read-time contract. It is NOT what gets
 * stored. What gets stored is the user's own partial record (`compactRule`
 * below), because §5.3's "a per-site override is absolute" depends on the
 * resolver being able to tell "the user chose this" from "this row is not
 * mentioned". `resolve()` therefore reads the RAW stored record and expands
 * only the rows a layer actually mentions.
 *
 * @param {object} partial     a partial or stored rule
 * @param {'global'|'factory'} fillWith
 *        'global'  — for the GLOBAL record: absent rows fall back to what the
 *                    global record currently has (the in-progress form value),
 *                    so a partial edit never drops the other rows.
 *        'factory' — for a PER-SITE record: absent rows are the factory
 *                    default. This is the rule that makes per-site rules
 *                    immune to later global changes.
 * @param {object} [globalBase] the current global record, used by 'global' fill
 */
function normaliseRule(partial, fillWith = 'global', globalBase = null) {
  const base = fillWith === 'global' && globalBase
    ? { ...FACTORY, ...globalBase }
    : { ...FACTORY };
  if (!partial || typeof partial !== 'object') return base;
  const out = { ...base };

  for (const key of Object.keys(ENUMS)) {
    if (partial[key] === undefined) continue;
    if (ENUMS[key].includes(partial[key])) out[key] = partial[key];
  }
  for (const key of ['fingerprinting', 'forgetMeOnClose', 'enabled']) {
    if (partial[key] === undefined) continue;
    out[key] = partial[key] === true;
  }
  for (const key of TRI_STATE_ROWS) {
    if (partial[key] === undefined) continue;
    out[key] = normaliseTriState(partial[key]);
  }
  // 'fpSub' is kept for the recon's field name but the per-target rows are the
  // real surface; keep them aligned with the source of truth.
  out.fpSub = out.fpSub;
  return out;
}

/**
 * The storage contract for a per-site override: the user's own choices, with
 * the factory default folded in ONLY for the rows the record mentions. A row
 * the user never touched is absent, so a later global change inherits cleanly
 * and a chosen row can never be rewritten by one.
 *
 * @param {object} partial
 * @returns {object} a record safe to put in storage.local
 */
function compactRule(partial) {
  if (!partial || typeof partial !== 'object') return {};
  const out = {};
  for (const key of Object.keys(ENUMS)) {
    if (partial[key] === undefined) continue;
    if (ENUMS[key].includes(partial[key])) out[key] = partial[key];
  }
  for (const key of ['fingerprinting', 'forgetMeOnClose', 'enabled']) {
    if (partial[key] === undefined) continue;
    out[key] = partial[key] === true;
  }
  for (const key of TRI_STATE_ROWS) {
    if (partial[key] === undefined) continue;
    out[key] = normaliseTriState(partial[key]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

/**
 * Resolves the effective rule for a request, per §5.3.
 *
 * @param {object} ctx
 * @param {object|null} ctx.siteRule   the stored per-site ShieldRule (or null)
 * @param {object}      ctx.globalRule the stored global ShieldRule
 * @param {object}      [ctx.session]  session overrides: {siteDisabled, elementRules}
 * @param {string}      [ctx.domain]   the document domain, for diagnostics
 * @returns {{rule: ShieldRule, layers: object, provenance: object}}
 *          `rule`      the effective values
 *          `layers`    which layer decided each row, for the panel's "overridden"
 *                      markers
 *          `provenance` 'session' | 'site' | 'global' for the Shields-up row
 */
/**
 * Resolves the effective rule for a request, per architecture §5.3.
 *
 * THE TRUTH TABLE (this is the product's core behaviour; the tests pin every
 * cell of it):
 *
 *   For an ordinary row R (adsTrackers / httpsUpgrade / scripts / cookies /
 *   forgetMeOnClose), in precedence order, the FIRST cell that applies wins:
 *
 *     | # | cell                                    | result              | layer   |
 *     |---|-----------------------------------------|---------------------|---------|
 *     | 1 | session says a value for R              | that value          | session |
 *     | 2 | per-site record names R (absolute)      | that value          | site    |
 *     | 3 | global record sets R                    | that value          | global  |
 *     | 4 | no layer mentioned R                    | FACTORY default     | factory |
 *
 *   For `enabled` (Shields up/down) the same table, with 'false' being the only
 *   value that can turn Shields off (an 'off' is what the user chose; an 'on' is
 *   the default and is indistinguishable from not mentioning it).
 *
 *   For each fingerprint sub-toggle S, the tri-state chain:
 *
 *     | # | cell                                    | result                     | layer   |
 *     |---|-----------------------------------------|----------------------------|---------|
 *     | 1 | session S is 'on' or 'off'               | that value                 | session |
 *     | 2 | per-site S is 'on' or 'off'              | that value                 | site    |
 *     | 3 | global S is 'on' or 'off'                | that value                 | global  |
 *     | 4 | global S is 'global' (inherit)           | 'global' -> ask the master | global  |
 *     | 5 | nothing anywhere                          | the global master's value  | factory |
 *
 * The two rules the recon is explicit about, both encoded above:
 *
 *  - **A per-site override is never rewritten by a later global change.** It is
 *    stored as an ABSOLUTE rule (compactRule keeps the user's own choices, not a
 *    diff), so cell 2 reads the raw stored record. Changing the global record
 *    later cannot alter cell 2's value, and a row the site never chose falls
 *    through to cell 3 and therefore FOLLOWS the new global. That is
 *    inheritance, not rewriting, and it is why `shields.site.<domain>` holds a
 *    full rule rather than a patch.
 *  - **Counts reset on navigation** — that is the session store's job, not here.
 *
 * @param {object} ctx
 * @param {object|null} ctx.siteRule   the stored per-site ShieldRule (or null)
 * @param {object}      ctx.globalRule the stored global ShieldRule
 * @param {object}      [ctx.session]  session overrides: {siteDisabled, scripts,
 *                                     cookies, httpsUpgrade, fingerprinting, subs}
 * @param {string}      [ctx.domain]   the document domain, for diagnostics
 * @returns {{rule: ShieldRule, layers: object, provenance: object}}
 *          `rule`       the effective values (booleans/enums, never tri-state)
 *          `layers`     which layer decided each row, for the panel's markers
 *          `provenance` the layer for the Shields-up row
 */
function resolve(ctx) {
  // The stored per-site record is read RAW: this is what distinguishes "the user
  // chose this row" (cell 2) from "this row is not mentioned" (cell 3). The
  // expanded form (normaliseRule(..., 'factory')) is the read contract for code
  // that wants every field; the resolver must not use it to decide precedence,
  // or every row would look site-chosen and later global changes could not
  // change anything.
  const rawSite = (ctx && ctx.siteRule && typeof ctx.siteRule === 'object') ? ctx.siteRule : null;
  const globalRaw = (ctx && ctx.globalRule && typeof ctx.globalRule === 'object') ? ctx.globalRule : null;
  const globalRule = normaliseRule(globalRaw, 'global', globalRaw || null);
  const session = (ctx && ctx.session && typeof ctx.session === 'object') ? ctx.session : null;

  /** Cell 2: a row the per-site record names by its own name, normalised. */
  const siteValue = (key) => {
    if (!rawSite || rawSite[key] === undefined) return undefined;
    if (key in ENUMS) return ENUMS[key].includes(rawSite[key]) ? rawSite[key] : undefined;
    if (BOOLEAN_ROWS.includes(key)) return rawSite[key] === true;
    return undefined;
  };

  /** Cell 2/3 for a tri-state row: 'on' | 'off' | undefined (inherit). */
  const triStateValue = (raw) => {
    if (!raw || typeof raw !== 'object') return undefined;
    if (raw.spotifyAdSlot === 'on' || raw.spotifyAdSlot === 'off') return raw.spotifyAdSlot;
    return undefined;
  };

  /** Cell 3: what the global record (or the factory default) says for a row. */
  const globalValue = (key) => {
    if (globalRaw && globalRaw[key] !== undefined) {
      if (key in ENUMS) return ENUMS[key].includes(globalRaw[key]) ? globalRaw[key] : FACTORY[key];
      if (BOOLEAN_ROWS.includes(key)) return globalRaw[key] === true;
    }
    return FACTORY[key];
  };

  /** Cell 1: what a session override says for a row, normalised. */
  const sessionValue = (key) => {
    if (!session || session[key] === undefined) return undefined;
    if (key in ENUMS) return ENUMS[key].includes(session[key]) ? session[key] : undefined;
    if (BOOLEAN_ROWS.includes(key)) return session[key] === true;
    return undefined;
  };

  const rule = {};
  const layers = {};
  const provenance = {};

  for (const { key } of ROWS) {
    // Cell 1 -> 2 -> 3 -> 4, for every row. Fingerprinting's master switch is a
    // boolean row like the others, so it flows through the same table; its
    // sub-toggles are resolved separately below with the tri-state table.
    if (key === 'spotifyAdSlot') {
      // Tri-state row: session -> per-site -> global -> factory.
      const s = triStateValue(session);
      if (s !== undefined) { rule[key] = s; layers[key] = 'session'; continue; }
      const v = triStateValue(rawSite);
      if (v !== undefined) { rule[key] = v; layers[key] = 'site'; continue; }
      const g = triStateValue(globalRaw);
      if (g !== undefined) {
        rule[key] = g; layers[key] = 'global'; provenance[key] = 'global';
      } else {
        rule[key] = FACTORY[key]; layers[key] = 'global';
      }
      continue;
    }
    const s = sessionValue(key);
    if (s !== undefined) { rule[key] = s; layers[key] = 'session'; continue; }
    const v = siteValue(key);
    if (v !== undefined) { rule[key] = v; layers[key] = 'site'; continue; }
    const g = globalValue(key);
    rule[key] = g;
    layers[key] = 'global';
  }

  // The row the recon calls "shield_enabled": false is the only meaningful
  // value (Shields down), so 'off' from the site is an override while 'on' is
  // indistinguishable from not mentioning it.
  {
    const s = sessionValue('enabled');
    const v = siteValue('enabled');
    const g = globalValue('enabled');
    if (s === false) { rule.enabled = false; provenance.enabled = 'session'; }
    else if (v === false) { rule.enabled = false; provenance.enabled = 'site'; }
    else { rule.enabled = g !== false; provenance.enabled = 'global'; }
  }

  // Layer 3: the fingerprint sub-toggles, tri-state (global | on | off).
  // 'global' means "inherit", and a sub-toggle that inherits all the way down
  // follows the master switch: protection on -> this target is protected.
  const masterOn = rule.fingerprinting !== false;
  const effectiveSubs = {};
  for (const key of FP_SUBTOGGLES) {
    let value = 'global';
    let layer = 'global';

    const sessionSub = session && session.subs ? session.subs[key] : undefined;
    if (sessionSub === 'on' || sessionSub === 'off') { value = sessionSub; layer = 'session'; }
    else if (rawSite && (rawSite[key] === 'on' || rawSite[key] === 'off')) {
      value = rawSite[key]; layer = 'site';
    } else if (globalRaw && (globalRaw[key] === 'on' || globalRaw[key] === 'off')) {
      value = globalRaw[key]; layer = 'global';
    }

    if (value === 'global') {
      // Inheriting the master switch is the only thing 'global' can mean for a
      // per-target override: the target string the shell writes either protects
      // every target (master on) or none of them (master off).
      effectiveSubs[key] = { value: masterOn ? 'on' : 'off', layer: 'master' };
    } else {
      effectiveSubs[key] = { value, layer };
    }
  }
  rule.fpSub = effectiveSubs;

  return { rule, layers, provenance };
}

/**
 * Writes the granularOverrides JSON for the winning values.
 * This is the value that MUST be a JSON array of {firstPartyDomain, overrides}
 * objects — the shell's crash was exactly a wrong value type here, see
 * replica/proofs-shell.md §1.6: `.overrides` takes the bare target string,
 * `.granularOverrides` takes the JSON array.
 *
 * @param {Array<{firstPartyDomain: string, overrides: string}>} entries
 * @returns {string} the JSON array, as a string, for the pref
 */
function serialiseGranularOverrides(entries) {
  return JSON.stringify(entries);
}

/**
 * Builds one {firstPartyDomain, overrides} entry from a resolved fingerprinting
 * decision. The overrides value is the bare RFP target string the shell's
 * FingerprintingWebCompatService expects: "+AllTargets,-CSSPrefersColorScheme"
 * with per-target "-Target" removals for the sub-toggles that are off.
 *
 * @param {string} domain   the first-party domain, or '*'
 * @param {boolean} on       fingerprint blocking master switch
 * @param {Array<[string, string, string]>} subStates  [key, value, layer]
 * @returns {{firstPartyDomain: string, overrides: string}}
 */
function buildGranularOverride(domain, on, subStates) {
  if (!on) {
    // Master switch off: no target string at all, and no entry.
    return null;
  }
  const parts = ['+AllTargets', '-CSSPrefersColorScheme'];
  for (const [key, value] of subStates) {
    if (value === 'off') {
      const target = FP_TARGETS[key];
      if (target) parts.push('-' + target);
    }
  }
  return { firstPartyDomain: domain, overrides: parts.join(',') };
}

/* ------------------------------------------------------------------ *
 * Dual-mode export (classic background script scope + plain node for tests).
 * ------------------------------------------------------------------ */
  return {
    FACTORY,
    ROWS,
    FP_SUBTOGGLES,
    FP_TARGETS,
    compactRule,
    STORAGE_KEY_GLOBAL,
    STORAGE_KEY_LISTS,
    siteKey,
    isDomain,
    normaliseRule,
    normaliseTriState,
    resolve,
    serialiseGranularOverrides,
    buildGranularOverride,
  };
});
