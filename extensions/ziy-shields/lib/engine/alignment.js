/* Ziy shields — the alignment between Ziy's Shields rows and the vocabulary the
 * source-landscape records in replica/re-deep-shields.md (Brave's public source,
 * 463 lines, cited there).
 *
 * Ziy's row names are its own: they are what the panel shows and what
 * storage.local keys are namespaced under (architecture §3.2's ShieldRule), so
 * they do not have to be Brave's. What MUST align is the SHAPE, because that is
 * the product behaviour the recon describes. This file is the documented mapping
 * so nobody has to guess which of our rows means which of theirs.
 *
 * The facts below are from re-deep-shields.md, which read them out of Brave's
 * public source. Storing the mapping here (rather than in the resolver) means
 * the resolver stays pure Ziy vocabulary and the alignment is a documented table.
 *
 * Two structural facts in that source worth stating plainly, because they
 * confirm our design:
 *
 *  1. "There is NO 'allow-list of major sites' file. The equivalent behaviour is
 *     first_party_protections:true on the default lists + brave-unbreak.txt
 *     shipped inside them." Ziy does not invent one either: EasyList ships its
 *     own exception rules and `@@` in the same file, which our compiler already
 *     handles at the LIST_EXCEPTION priority.
 *  2. "'Global shields off' is structurally impossible (EnsureNoWildcardEntries)
 *     and a per-site BLOCK is stored only when it differs." Our per-site rules
 *     are absolute records of the user's own choices and a global 'off' would be
 *     a global record with enabled:false — which our resolver honours as a
 *     default, so the difference is deliberate: Ziy's global record is a real
 *     editable default (architecture §5.3's layer 4), not an unrepresentable
 *     state. The recon's per-site rule — "never rewritten by a later global
 *     change" — is what both designs share.
 */

/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md §2)
 *
 * This file is loaded as a classic <script> in the shared global scope of
 * the event page, next to the other ziy-shields lib files. It therefore
 * declares NOTHING at the top level: the whole body lives inside the
 * factory below. A second top-level declaration of a name another file
 * already owns is a PARSE-time SyntaxError in that scope ("redeclaration
 * of non-configurable global property"), the engine discards the whole
 * file, and every listener in it fails to register — which is precisely
 * defect D-2 in replica/test-report.md. The API is published on the one
 * `ziyShields` namespace this extension shares, and on module.exports
 * under node --test.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  if (!root.ziyShields) root.ziyShields = {};
  const api = factory();
  Object.assign(root.ziyShields, api);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.ROW_ALIGNMENT = api.ROW_ALIGNMENT;
    exports.FARBLING_TARGETS = api.FARBLING_TARGETS;
    exports.FP_SUBTOGGLE_SOURCES = api.FP_SUBTOGGLE_SOURCES;
    exports.FP_KEY_TO_TARGET = api.FP_KEY_TO_TARGET;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

'use strict';

/**
 * Ziy row -> the row vocabulary in re-deep-shields.md.
 *
 * @type {Readonly<Record<string, {source: string, sourceValue: string, note: string}>>}
 */
const ROW_ALIGNMENT = Object.freeze({
  enabled: Object.freeze({
    source: 'BRAVE_SHIELDS ("braveShields")',
    sourceValue: 'CONTENT_SETTING_ALLOW = shields on by default',
    note: 'A per-site off is an absolute record with enabled:false, exactly the ' +
      'recon\'s "Shields down for this site persists" behaviour.',
  }),
  adsTrackers: Object.freeze({
    source: 'BRAVE_ADS / BRAVE_TRACKERS ("shieldsAds", "trackers") + BRAVE_COSMETIC_FILTERING ("cosmeticFilteringV2")',
    sourceValue: 'AdBlockMode {AGGRESSIVE, STANDARD, ALLOW}',
    note: 'One row writes TWO settings there: the block/allow one and the cosmetic ' +
      'one. Standard -> cosmetic is BLOCK_THIRD_PARTY, Aggressive -> BLOCK, Allow ' +
      '-> ALLOW. There is no "block aggressive" flag on the row itself: the mode ' +
      'chooses which LIST is used, which is why Ziy keeps the three-value row.',
  }),
  httpsUpgrade: Object.freeze({
    source: 'BRAVE_HTTPS_UPGRADE ("httpsUpgrades") + BRAVE_HTTP_UPGRADABLE_RESOURCES ("httpUpgradableResources")',
    sourceValue: 'HttpsUpgradeMode {STRICT_MODE, STANDARD_MODE, DISABLED_MODE}',
    note: 'Their default is CONTENT_SETTING_ASK, which reads as "prefer". On Gecko ' +
      'the equivalent is the shell\'s dom.security.https_only_mode, already locked; ' +
      'Ziy\'s strict is a documented variant.',
  }),
  scripts: Object.freeze({
    source: 'stock ContentSettingsType::JAVASCRIPT ("javascript")',
    sourceValue: 'allow | block',
    note: 'Not a Brave-specific type. Ziy maps it to a DNR allow-restricted-to-script ' +
      'rule at SITE_ALLOW priority, which is the same shape.',
  }),
  cookies: Object.freeze({
    source: 'BRAVE_COOKIES ("shieldsCookiesV3")',
    sourceValue: 'CookieBlockMode {CROSS_SITE_BLOCKED, BLOCKED, ALLOW}',
    note: 'Their three values are the same three positions as ours; the names differ ' +
      'only in wording.',
  }),
  fingerprinting: Object.freeze({
    source: 'BRAVE_FINGERPRINTING_V2 ("fingerprintingV2")',
    sourceValue: 'FingerprintMode {STRICT_MODE, STANDARD_MODE, ALLOW_MODE}',
    note: 'FarblingLevel {OFF, BALANCED, MAXIMUM} is derived from it: ALLOW -> OFF, ' +
      'DEFAULT(=STANDARD) -> BALANCED, BLOCK(=STRICT) -> MAXIMUM. On Gecko the ' +
      'equivalent is privacy.resistFingerprinting plus the per-target ' +
      'granularOverrides Ziy writes.',
  }),
  forgetMeOnClose: Object.freeze({
    source: 'BRAVE_REMEMBER_1P_STORAGE / BRAVE_AUTO_SHRED ("braveAutoShred")',
    sourceValue: 'AutoShredMode {NEVER, LAST_TAB_CLOSED, APP_EXIT}',
    note: 'Their boolean was later rewritten to the three-value mode. Ziy ships the ' +
      'boolean (the recon\'s field) and leaves the three-value mode as a documented ' +
      'variant, since eTLD+1 storage teardown is engine work on their side and ours ' +
      'would be a cookie/lifetimePolicy combination.',
  }),
  spotifyAdSlot: Object.freeze({
    source: 'Ziy-owned row — no Brave counterpart. Brave has NO Spotify handling ' +
      'anywhere in brave-core (verified by a case-insensitive grep for spotify / ' +
      'spotifycdn / audio-fa across the sparse components/brave_shields and ' +
      'components/adblock checkout, which returns nothing). Brave blocks Spotify ' +
      'ads through the same filter-list path as every other site.',
    sourceValue: 'global|on|off (tri-state, like the fingerprinting sub-toggles)',
    note: 'The co-owner\'s requirement: the naive block leaves the web player ' +
      'stalled in the ad slot and the song never follows. Ziy lets the ad SLOT ' +
      'play (muted, so no ad audio) and lets the slot end, so the song follows; ' +
      'the mute is done by the content script and the ad DELIVERY hosts are ' +
      'carried by the list tier. That split is what makes "block the ad AND let ' +
      'the song play" true. Default ON. Applies to open.spotify.com and the ' +
      'Spotify Web Player only — never the desktop client. Evidence: ' +
      'replica/proofs-blocking-strength.md §5.',
  }),
});

/**
 * The 19 discrete farbling targets from re-deep-shields.md §5, each mapped to
 * the RFP target Ziy writes into granularOverrides (the RFPTargets.inc names the
 * shell's shell already uses).
 *
 * A target Ziy cannot express on Gecko maps to `null` and is dropped from the
 * target string rather than faked — writing a target name the engine does not
 * know would be rejected by FingerprintingWebCompatService's schema.
 *
 * @type {ReadonlyArray<{key: string, source: string, label: string, rfpTarget: string|null, balanced: string, maximum: string}>}
 */
const FARBLING_TARGETS = Object.freeze([
  Object.freeze({ key: 'fpAudio', source: 'brave-webcompat-audio', label: 'Audio',
    rfpTarget: 'AudioChannel', balanced: 'multiply by 0.999 + rand/1000', maximum: 'LFSR sample replacement' }),
  Object.freeze({ key: 'fpCanvas', source: 'brave-webcompat-canvas', label: 'Canvas',
    rfpTarget: 'CanvasRandomization', balanced: 'HMAC-SHA256 over pixels', maximum: 'same' }),
  Object.freeze({ key: 'fpDeviceMemory', source: 'brave-webcompat-device-memory', label: 'Device memory',
    rfpTarget: 'JSLocaleNavigatorDeviceMemory', balanced: 'pick from {4,8,16,32}', maximum: 'pick from {2,4,8,16,32}' }),
  Object.freeze({ key: 'fpEventSourcePool', source: 'brave-webcompat-event-source-pool', label: 'Event source pool',
    rfpTarget: null, balanced: 'per-context pool budget; refuse when exhausted', maximum: 'same' }),
  Object.freeze({ key: 'fpFont', source: 'brave-webcompat-font', label: 'Installed fonts',
    rfpTarget: 'FontVisibility', balanced: 'about 5% of families allowed', maximum: 'non-whitelisted blocked outright' }),
  Object.freeze({ key: 'fpHardware', source: 'brave-webcompat-hardware-concurrency', label: 'Hardware concurrency',
    rfpTarget: 'NavigatorHWConcurrency', balanced: 'random in [4, true]', maximum: 'random in [4, 8]' }),
  Object.freeze({ key: 'fpKeyboard', source: 'brave-webcompat-keyboard', label: 'Keyboard layout',
    rfpTarget: 'NavigatorKeyboardLayout', balanced: 'null when farbled', maximum: 'null' }),
  Object.freeze({ key: 'fpLanguage', source: 'brave-webcompat-language', label: 'Language',
    rfpTarget: 'JSLocaleLocale', balanced: 'keep first language only', maximum: 'replace with en-US/en' }),
  Object.freeze({ key: 'fpMediaDevices', source: 'brave-webcompat-media-devices', label: 'Media devices',
    rfpTarget: 'NavigatorEnumerateMediaDevices', balanced: 'shuffle from 2nd device', maximum: 'same' }),
  Object.freeze({ key: 'fpPlugins', source: 'brave-webcompat-plugins', label: 'Plugins',
    rfpTarget: 'NavigatorPlugins', balanced: '2 fake plugins + shuffle', maximum: 'clear the list' }),
  Object.freeze({ key: 'fpScreen', source: 'brave-webcompat-screen', label: 'Screen size',
    rfpTarget: 'ScreenRect', balanced: 'farble window/screen sizes', maximum: 'same with screen-info override' }),
  Object.freeze({ key: 'fpSpeechSynthesis', source: 'brave-webcompat-speech-synthesis', label: 'Speech synthesis voices',
    rfpTarget: 'SpeechSynthesis', balanced: '1 fake voice added', maximum: 'empty voice list' }),
  Object.freeze({ key: 'fpUsbSerial', source: 'brave-webcompat-usb-device-serial-number', label: 'USB device serial',
    rfpTarget: null, balanced: 'random 16-char string', maximum: 'same' }),
  Object.freeze({ key: 'fpUserAgent', source: 'brave-webcompat-user-agent', label: 'User agent',
    rfpTarget: 'NavigatorUserAgent', balanced: 'append 0-4 trailing spaces', maximum: 'same' }),
  Object.freeze({ key: 'fpWebgl', source: 'brave-webcompat-webgl', label: 'WebGL',
    rfpTarget: 'WebGLRenderInfo', balanced: '1 fake extension injected', maximum: 'scrub vendor/architecture' }),
  Object.freeze({ key: 'fpWebgl2', source: 'brave-webcompat-webgl2', label: 'WebGL2',
    rfpTarget: 'WebGLRenderInfo', balanced: 'same', maximum: 'same' }),
  Object.freeze({ key: 'fpWebgpu', source: 'brave-webcompat-webgpu', label: 'WebGPU adapter',
    rfpTarget: 'WebGPUAdapterInfo', balanced: 'empty vendor/architecture', maximum: 'empty strings' }),
  Object.freeze({ key: 'fpWebSocketsPool', source: 'brave-webcompat-web-sockets-pool', label: 'Web sockets pool',
    rfpTarget: null, balanced: 'per-context pool budget', maximum: 'same' }),
  Object.freeze({ key: 'fpSentinel', source: 'brave-webcompat-none', label: 'Global default level',
    rfpTarget: null, balanced: 'the sentinel: the global level, not a per-target toggle', maximum: '—' }),
]);

/** The sub-toggle keys, in the source's order (the panel renders them in this order). */
const FP_SUBTOGGLE_SOURCES = Object.freeze(FARBLING_TARGETS.map(t => t.key));

/** Ziy's own sub-toggle key -> RFP target, for the targets Gecko can express. */
const FP_KEY_TO_TARGET = Object.freeze(Object.fromEntries(
  FARBLING_TARGETS.filter(t => t.rfpTarget).map(t => [t.key, t.rfpTarget]),
));

  return {
    ROW_ALIGNMENT,
    FARBLING_TARGETS,
    FP_SUBTOGGLE_SOURCES,
    FP_KEY_TO_TARGET,
  };
});
