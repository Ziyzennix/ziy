/* Ziy shields — content script: element hiding.
 *
 * Cosmetic rules from the filter lists and the block-element tool live here.
 * The script asks the event page for the current domain's selectors and installs
 * one <style> per group. It also re-runs on DOM mutations, because the whole
 * point of hiding an ad slot is that it appears after the first paint.
 *
 * This script runs in the ISOLATED world (the manifest default) and never
 * touches the page's own globals: it reads the document only to hide nodes.
 */

'use strict';

(function () {
  const host = location.hostname.replace(/^www\./, '');
  let styleEl = null;
  let userStyleEl = null;
  let lastCss = '';
  let lastUserCss = '';

  function send(op, body) {
    const b = (typeof browser !== 'undefined' ? browser : chrome);
    return b.runtime.sendMessage({ op, body });
  }

  function ensureStyle(which) {
    const el = which === 'user' ? userStyleEl : styleEl;
    if (el && el.isConnected) return el;
    const created = document.createElement('style');
    created.setAttribute('data-ziy-shields', which);
    created.type = 'text/css';
    head().appendChild(created);
    if (which === 'user') userStyleEl = created;
    else styleEl = created;
    return created;
  }

  function head() {
    return document.head || document.documentElement || document.body;
  }

  function applyCss(which, css) {
    if (which === 'user') lastUserCss = css;
    else lastCss = css;
    const el = ensureStyle(which);
    if (el.textContent !== css) el.textContent = css;
  }

  /** Evaluates an extended (procedural) selector and hides the matches. */
  function applyExtended(extendedRules) {
    for (const rule of extendedRules) {
      let nodes = [];
      try {
        if (rule.selector.startsWith(':xpath(') || /:[a-z-]*xpath\s*\(/.test(rule.selector)) {
          const xp = /:xpath\((?:"([^"]*)"|'([^']*)')\)/.exec(rule.selector);
          if (xp) {
            const expr = xp[1] !== undefined ? xp[1] : xp[2];
            const snap = document.evaluate(expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < snap.snapshotLength; i++) nodes.push(snap.snapshotItem(i));
          }
        } else if (rule.selector.includes(':has-text(')) {
          const match = /^([^:]+):has-text\((?:"([^"]*)"|'([^']*)')\)/.exec(rule.selector);
          if (match) {
            const needle = match[2] !== undefined ? match[2] : match[3];
            try {
              for (const el of document.querySelectorAll(match[1])) {
                if (el.textContent && el.textContent.includes(needle)) nodes.push(el);
              }
            } catch (e) { /* unknown pseudo-class: skip, never throw */ }
          }
        } else if (rule.selector.includes(':contains(')) {
          const match = /^([^:]+):contains\((?:"([^"]*)"|'([^']*)')\)/.exec(rule.selector);
          if (match) {
            const needle = match[2] !== undefined ? match[2] : match[3];
            try {
              for (const el of document.querySelectorAll(match[1])) {
                if (el.textContent && el.textContent.includes(needle)) nodes.push(el);
              }
            } catch (e) { /* skip */ }
          }
        } else {
          try { nodes = [...document.querySelectorAll(rule.selector)]; }
          catch (e) { nodes = []; }
        }
      } catch (e) { nodes = []; }

      for (const node of nodes) {
        if (node && node.setAttribute) node.setAttribute('data-ziy-shield-hidden', 'user-selector');
      }
    }
  }

  /** Handles a user's block-element rule from the extension's element picker. */
  function hideUserSelector(selector) {
    const parts = selector.split('\n').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const css = parts.map(s => `${s} { display: none !important; }`).join('\n');
    applyCss('user', lastUserCss + '\n' + css);
    // Re-apply on DOM changes for a few seconds: the ad slot often arrives late.
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (tries > 40) clearInterval(timer);
    }, 100);
  }

  async function refresh() {
    try {
      const res = await send('shields.cosmetic', { host });
      if (!res || res.ok !== true) return;
      applyCss('list', res.cosmetic.css || '');
      applyExtended(res.cosmetic.extended || []);
    } catch (e) { /* the event page may be starting: try again shortly */ }
  }

  // Observe the DOM for late-arriving slots. Debounced: a busy page can mutate
  // hundreds of times a second and the stylesheet is one element either way.
  if (typeof MutationObserver === 'function') {
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame ? requestAnimationFrame(refresh) : setTimeout(refresh, 16);
      setTimeout(() => { scheduled = false; }, 300);
    });
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // Listen for the element picker's message.
  const b = (typeof browser !== 'undefined' ? browser : chrome);
  if (b.runtime && b.runtime.onMessage) {
    b.runtime.onMessage.addListener((message) => {
      if (message && message.op === 'shields.hideUserSelector') {
        hideUserSelector(message.body && message.body.selector);
      }
    });
  }

  refresh();
})();
