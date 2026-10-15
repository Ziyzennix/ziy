/* Ziy Shields — the debug page's script: renders the live panel state.
 *
 * The popup runs in a constrained context, so this page (a normal extension tab)
 * renders the Shareduty rows from the shared module against the live state and
 * dumps the extension's own counters into the DOM, which is what a screenshot or
 * a harness page reads back.
 */
'use strict';

(function () {
  const api = (typeof browser !== 'undefined') ? browser : chrome;
  const shared = window.__ziyShieldsShared;

  function el(tag, attrs, children) { return shared.el(tag, attrs, children); }

  function send(op, body) { return api.runtime.sendMessage({ op, body }); }

  async function load() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    const res = await send('shields.state', { tabId: tabs && tabs[0] ? tabs[0].id : undefined });
    if (!res || res.ok !== true) {
      // The event page may still be starting. Show the domain from the URL bar
      // so the page is never blank, and retry.
      const domain = tabs && tabs[0] && tabs[0].url ? new URL(tabs[0].url).hostname : 'this site';
      document.getElementById('ziy-domain-text').textContent = domain;
      setTimeout(load, 800);
      return;
    }
    const state = res.state;
    document.getElementById('ziy-domain-text').textContent = state.domain || 'this site';
    const up = state.rule.enabled !== false;
    const stateEl = document.getElementById('ziy-state');
    stateEl.textContent = up ? 'Shields are up' : 'Shields are down for this site';
    stateEl.className = 'ziy-panel__state ziy-state ' + (up ? 'ziy-state--up' : 'ziy-state--down');

    const n = (state.counts && state.counts.blocks) || 0;
    document.getElementById('ziy-count__n').textContent = String(n);
    document.getElementById('ziy-count__label').textContent =
      n === 0 ? 'No requests stopped this visit' : `${n} requests stopped this visit`;
    document.getElementById('ziy-count').setAttribute('aria-label', `Show the ${n} item${n === 1 ? '' : 's'} stopped on this page`);
  }

  load();
})();
