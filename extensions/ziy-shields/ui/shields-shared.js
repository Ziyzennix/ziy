/* Ziy shields — shared UI logic for the popup and the options page.
 *
 * The panel (recon S07/S08) and the global settings page (S10) are the same
 * rows in the same order with the same tri-state semantics; only the source of
 * truth differs. The panel resolves an EFFECTIVE rule through the §5.3
 * precedence model, the options page edits the global record.
 *
 * Accessibility is not optional here (replica/design/components.md): every row
 * is a labelled control, the "overridden" state is announced, focus-visible is
 * a 2px ring + 2px offset, and 0 is information, never a disabled state.
 */

/* No top-level declarations: this file is loaded by the popup, the options
 * page and the debug page as a classic <script>, and it publishes its API
 * on the window global __ziyShieldsShared that those pages read. */
/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md S2)
 *
 * Loaded by the popup, the options page and the debug page as classic
 * <script> tags, this file shares their global scope. Its API therefore
 * lands on `window.__ziyShieldsShared`, the global those pages read, and
 * on module.exports under node --test. Nothing is declared at the top
 * level, so no name can collide with another file in the same scope.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  const api = factory();
  root.__ziyShieldsShared = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
      exports.COPY = api.COPY;
      exports.ROWS = api.ROWS;
      exports.el = api.el;
      exports.toggleRow = api.toggleRow;
      exports.segmentedRow = api.segmentedRow;
      exports.dropdownRow = api.dropdownRow;
      exports.readRows = api.readRows;
      exports.subLabel = api.subLabel;
      exports.api = api.api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

/* The API global of this page. In a page context that is `browser` (Gecko)
 * or `chrome` (the MV3 alias); under node --test neither exists and the
 * value stays null, which is correct because the rows are pure data. */
const API_GLOBALS = ['browser', 'chrome'];
const api = API_GLOBALS
  .map((name) => (typeof globalThis !== 'undefined' ? globalThis[name] : undefined))
  .find((candidate) => candidate && candidate.runtime) || null;

/* ------------------------------------------------------------------ *
 * Labels — Ziy's own voice.
 *
 * The recon and the design system both require fresh copy: the reference's
 * phrasing never appears. Everything below is written for Ziy.
 * ------------------------------------------------------------------ */

const COPY = Object.freeze({
  panelTitle: 'Ziy Shields',
  simpleHeading: 'Protection for this site',
  advancedHeading: 'Protection details',
  advancedControls: 'Detailed controls',
  shieldsUp: 'Shields are up',
  shieldsDown: 'Shields are down for this site',
  turnShieldsUp: 'Turn Shields on for this site',
  turnShieldsDown: 'Turn Shields off for this site',
  countOne: (n) => `${n} request stopped this visit`,
  countMany: (n) => `${n} requests stopped this visit`,
  countNone: 'No requests stopped this visit',
  blockedLink: (n) => `Show the ${n} item${n === 1 ? '' : 's'} stopped on this page`,
  overriddenSuffix: (label) => `${label}, changed for this site`,
  inheritedSuffix: (label) => `${label}, following your global setting`,
  simpleReadOnlyHint: 'Switch to detailed controls to change these.',
  resetSite: 'Restore this site to your global setting',
  close: 'Close',
  // rows
  rowAds: 'Trackers and ads',
  rowAdsStd: 'Standard',
  rowAdsAgg: 'Aggressive',
  rowAdsOff: 'Off',
  rowHttps: 'Upgrade to HTTPS',
  rowHttpsAuto: 'Automatic',
  rowHttpsStrict: 'Strict',
  rowHttpsOff: 'Off',
  rowScripts: 'Scripts',
  rowScriptsBlock: 'Block scripts',
  rowScriptsAllow: 'Allow scripts',
  rowCookies: 'Cookies',
  rowCookiesBlock3p: 'Block third-party cookies',
  rowCookiesBlockAll: 'Block all cookies',
  rowCookiesAllowAll: 'Allow all cookies',
  rowFp: 'Block fingerprinting',
  rowFpOn: 'Block fingerprinting',
  rowFpOff: 'Allow fingerprinting',
  fpCanvas: 'Canvas',
  fpFonts: 'Installed fonts',
  fpLocale: 'Locale and language',
  fpHardware: 'Hardware details',
  fpScreen: 'Screen size',
  fpTimer: 'Timer precision',
  rowForget: 'Forget me when I close this site',
  // options page
  optionsHeading: 'Shields defaults',
  optionsIntro: 'These are your defaults for every site. A site you change later keeps its own setting, and changing this page never rewrites what a site already chose.',
  // lists
  listsHeading: 'Filter lists',
  listsIntro: 'Blocking comes from public filter lists. Turning one off stops the rules it contributes right away; the downloaded copy is kept so you can turn it back on without waiting for a download.',
  listPlaceholder: 'List address (https://…)',
  addList: 'Add list',
  updateNow: 'Check for updates now',
  checkedAt: (d) => d ? `Checked ${new Date(d).toLocaleString()}` : 'Not checked yet',
  // messages
  saved: 'Saved',
  errorDomain: 'That does not look like a site address.',
  errorFetch: 'That list could not be fetched. Check the address and try again.',
});

/* ------------------------------------------------------------------ *
 * Row model — the display order from the recon's S08.
 * ------------------------------------------------------------------ */

const ROWS = [
  { key: 'adsTrackers', kind: 'segmented', label: COPY.rowAds,
    options: [
      { value: 'standard', label: COPY.rowAdsStd },
      { value: 'aggressive', label: COPY.rowAdsAgg },
      { value: 'off', label: COPY.rowAdsOff },
    ],
    hint: 'Aggressive blocks more broadly and is the right choice when a page is still showing ads.',
  },
  { key: 'httpsUpgrade', kind: 'segmented', label: COPY.rowHttps,
    options: [
      { value: 'auto', label: COPY.rowHttpsAuto },
      { value: 'strict', label: COPY.rowHttpsStrict },
      { value: 'off', label: COPY.rowHttpsOff },
    ],
    hint: 'Strict is the variant for when a page must go through HTTPS at all times.',
  },
  { key: 'scripts', kind: 'switch', label: COPY.rowScripts,
    onLabel: COPY.rowScriptsBlock, offLabel: COPY.rowScriptsAllow },
  { key: 'cookies', kind: 'dropdown', label: COPY.rowCookies,
    options: [
      { value: 'block_3p', label: COPY.rowCookiesBlock3p },
      { value: 'block_all', label: COPY.rowCookiesBlockAll },
      { value: 'allow_all', label: COPY.rowCookiesAllowAll },
    ] },
  { key: 'fingerprinting', kind: 'switch', label: COPY.rowFp,
    onLabel: COPY.rowFpOn, offLabel: COPY.rowFpOff,
    subToggles: [
      { key: 'fpCanvas', label: COPY.fpCanvas },
      { key: 'fpFonts', label: COPY.fpFonts },
      { key: 'fpLocale', label: COPY.fpLocale },
      { key: 'fpHardware', label: COPY.fpHardware },
      { key: 'fpScreen', label: COPY.fpScreen },
      { key: 'fpTimer', label: COPY.fpTimer },
    ] },
  { key: 'forgetMeOnClose', kind: 'switch', label: COPY.rowForget },
];

function subLabel(key) {
  for (const row of ROWS) {
    for (const sub of (row.subToggles || [])) {
      if (sub.key === key) return sub.label;
    }
  }
  return key;
}

/* ------------------------------------------------------------------ *
 * Rendering helpers — one component per design spec, no framework.
 * ------------------------------------------------------------------ */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else if (k === 'role') node.setAttribute('role', v);
    else if (k === 'aria') Object.assign(node.attributes, {});
    else if (k === 'checked') node.checked = v;
    else node.setAttribute(k, v);
  }
  if (attrs.aria) {
    for (const [ak, av] of Object.entries(attrs.aria)) node.setAttribute('aria-' + ak, av);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** A permission-style toggle row (design component #3). */
function toggleRow(row, value, opts = {}) {
  const id = 'ziy-row-' + row.key;
  const on = value === true;
  const wrap = el('div', { class: 'ziy-row' + (opts.overridden ? ' ziy-row--overridden' : '') });
  const label = el('label', { class: 'ziy-row__label', for: id }, [
    document.createTextNode(row.label),
    opts.overridden ? el('span', { class: 'ziy-row__dot', 'aria-hidden': 'true' }) : null,
  ]);
  const input = el('input', {
    class: 'ziy-switch',
    id,
    type: 'checkbox',
    role: 'switch',
  });
  input.checked = on;
  input.setAttribute('aria-checked', String(on));
  if (opts.disabled) {
    input.setAttribute('aria-disabled', 'true');
    if (opts.reason) input.setAttribute('aria-describedby', id + '-why');
  }
  wrap.appendChild(label);
  if (opts.overridden) {
    wrap.appendChild(el('span', {
      class: 'ziy-row__overridden', role: 'status',
      text: 'Changed for this site',
    }));
  }
  if (opts.reason) {
    wrap.appendChild(el('p', { class: 'ziy-row__why', id: id + '-why', text: opts.reason }));
  }
  wrap.appendChild(input);

  // Sub-toggles: tri-state radio group per the design's segmented-control
  // pattern (roving tabindex, role=radiogroup with aria-checked radios).
  if (row.subToggles && opts.fingerprinting) {
    const group = el('div', {
      class: 'ziy-subs', role: 'group',
      aria: { label: 'Fingerprint protection details' },
    });
    for (const sub of row.subToggles) {
      const state = (opts.fingerprinting && opts.fingerprinting[sub.key]) || { value: 'global', layer: 'global' };
      const subId = `ziy-sub-${sub.key}`;
      const line = el('div', { class: 'ziy-sub' });
      line.appendChild(el('span', { class: 'ziy-sub__label', text: sub.label, id: subId }));
      const radioWrap = el('div', {
        class: 'ziy-segmented ziy-segmented--sub',
        role: 'radiogroup',
        aria: { labelledby: subId },
      });
      for (const opt of [{ value: 'global', label: 'Global' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]) {
        const rid = `${subId}-${opt.value}`;
        const radio = el('input', { id: rid, type: 'radio', name: subId, value: opt.value });
        radio.checked = state.value === opt.value;
        const radioLabel = el('label', { class: 'ziy-segmented__opt', for: rid, text: opt.label });
        radioWrap.appendChild(radio);
        radioWrap.appendChild(radioLabel);
      }
      line.appendChild(radioWrap);
      group.appendChild(line);
    }
    wrap.appendChild(group);
  }
  return { wrap, input };
}

/** A segmented control (design component #4). */
function segmentedRow(row, value, opts = {}) {
  const id = 'ziy-seg-' + row.key;
  const wrap = el('div', { class: 'ziy-row' + (opts.overridden ? ' ziy-row--overridden' : '') });
  const label = el('span', { class: 'ziy-row__label', id }, [
    document.createTextNode(row.label),
    opts.overridden ? el('span', { class: 'ziy-row__dot', 'aria-hidden': 'true' }) : null,
  ]);
  wrap.appendChild(label);
  if (opts.overridden) {
    wrap.appendChild(el('span', { class: 'ziy-row__overridden', role: 'status', text: 'Changed for this site' }));
  }
  const group = el('div', { class: 'ziy-segmented', role: 'radiogroup', aria: { labelledby: id } });
  for (const opt of row.options) {
    const rid = `${id}-${opt.value}`;
    const radio = el('input', { id: rid, type: 'radio', name: id, value: opt.value });
    radio.checked = value === opt.value;
    const radioLabel = el('label', { class: 'ziy-segmented__opt', for: rid, text: opt.label });
    group.appendChild(radio);
    group.appendChild(radioLabel);
  }
  wrap.appendChild(group);
  if (row.hint) wrap.appendChild(el('p', { class: 'ziy-row__hint', text: row.hint, 'aria-live': 'off' }));
  return { wrap, group };
}

/** A dropdown setting (design component #5) — native <select>. */
function dropdownRow(row, value, opts = {}) {
  const id = 'ziy-select-' + row.key;
  const wrap = el('div', { class: 'ziy-row' + (opts.overridden ? ' ziy-row--overridden' : '') });
  const label = el('label', { class: 'ziy-row__label', for: id }, [
    document.createTextNode(row.label),
    opts.overridden ? el('span', { class: 'ziy-row__dot', 'aria-hidden': 'true' }) : null,
  ]);
  wrap.appendChild(label);
  if (opts.overridden) {
    wrap.appendChild(el('span', { class: 'ziy-row__overridden', role: 'status', text: 'Changed for this site' }));
  }
  const select = el('select', { class: 'ziy-select', id });
  for (const opt of row.options) {
    const option = el('option', { value: opt.value, text: opt.label });
    if (value === opt.value) option.selected = true;
    select.appendChild(option);
  }
  wrap.appendChild(select);
  return { wrap, select };
}

/* ------------------------------------------------------------------ *
 * Reading the rows back out of a rendered panel
 * ------------------------------------------------------------------ */

function readRows(container) {
  const out = {};
  for (const row of ROWS) {
    if (row.kind === 'switch') {
      const input = container.querySelector('#ziy-row-' + row.key);
      out[row.key] = input ? input.checked : undefined;
      if (row.subToggles) {
        out[row.key] = {};
        for (const sub of row.subToggles) {
          const checked = container.querySelector(`input[name="ziy-sub-${sub.key}"]:checked`);
          if (checked) out[row.key][sub.key] = { value: checked.value, layer: 'ui' };
        }
      }
      continue;
    }
    if (row.kind === 'segmented') {
      const checked = container.querySelector(`input[name="ziy-seg-${row.key}"]:checked`);
      if (checked) out[row.key] = checked.value;
      continue;
    }
    if (row.kind === 'dropdown') {
      const select = container.querySelector('#ziy-select-' + row.key);
      if (select) out[row.key] = select.value;
    }
  }
  return out;
}

  return {
    COPY,
    ROWS,
    el,
    toggleRow,
    segmentedRow,
    dropdownRow,
    readRows,
    subLabel,
    api,
  };
});
