/* Ziy Shields — the popup (browser_action panel, recon S07/S08).
 *
 * Two views in one document, exactly as the recon describes:
 *   Simple   the read-only summary plus the Shields up/down control.
 *   Advanced the full rows with tri-state sub-toggles and the blocked-items
 *            count link.
 *
 * The popup never reads the rule table itself; it asks the event page through
 * `shields.state` and gets back the resolved rule, the layer that decided each
 * row (so a row can show its "changed for this site" state) and this tab's
 * counts. It writes through `shields.setSite` / `shields.clearSite`.
 *
 * Focus behaviour follows design component #2: focus moves to the panel
 * heading on open, Esc closes, and the count announcement happens in a polite
 * live region rather than by moving focus.
 */

'use strict';

(function () {
  const shared = window.__ziyShieldsShared;
  const COPY = shared.COPY;
  const ROWS = shared.ROWS;
  const api = shared.api;

  const domainEl = document.getElementById('ziy-domain');
  const stateEl = document.getElementById('ziy-state');
  const countEl = document.getElementById('ziy-count');
  const countN = document.getElementById('ziy-count__n');
  const countLabel = document.getElementById('ziy-count__label');
  const shutdownBtn = document.getElementById('ziy-shutdown');
  const simpleSection = document.getElementById('ziy-simple');
  const advancedSection = document.getElementById('ziy-advanced');
  const itemsSection = document.getElementById('ziy-items');
  const itemsList = document.getElementById('ziy-items__list');
  const itemsEmpty = document.getElementById('ziy-items__empty');

  let state = null;
  let isAdvanced = false;

  function send(op, body) {
    return api.runtime.sendMessage({ op, body });
  }

  async function activeTab() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  }

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */

  function renderSummary() {
    const domain = (state && state.domain) || 'this site';
    domainEl.textContent = domain;
    const up = state && state.rule && state.rule.enabled !== false;
    stateEl.textContent = up ? COPY.shieldsUp : COPY.shieldsDown;
    stateEl.classList.toggle('ziy-state--up', up);
    stateEl.classList.toggle('ziy-state--down', !up);
    shutdownBtn.textContent = up ? COPY.turnShieldsDown : COPY.turnShieldsUp;
    shutdownBtn.setAttribute('aria-pressed', String(!up));
  }

  function renderCount() {
    const counts = (state && state.counts) || { blocks: 0, items: [], kb: 0, seconds: 0 };
    const n = counts.blocks || 0;
    // ONE combined number: ads and trackers together, matching the observed
    // stats widget. Ziy's wording, not the reference's.
    countN.textContent = String(n);
    countLabel.textContent = n === 0
      ? 'trackers and ads stopped this visit'
      : `trackers and ads stopped this visit`;
    countEl.setAttribute('aria-label', `Show the ${n} item${n === 1 ? '' : 's'} stopped on this page`);

    const countOut = document.getElementById('ziy-stats__count');
    const kbOut = document.getElementById('ziy-stats__bandwidth');
    const timeOut = document.getElementById('ziy-stats__time');
    if (countOut) countOut.textContent = String(n);
    if (kbOut) kbOut.textContent = formatKb(counts.kb || 0);
    if (timeOut) timeOut.textContent = formatSeconds(counts.seconds || 0);

    renderItems(counts.items || []);
  }

  function formatKb(kb) {
    if (kb < 1024) return `${Math.round(kb)} kB`;
    const mb = kb / 1024;
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }

  function formatSeconds(seconds) {
    if (seconds < 60) return `${Math.round(seconds)} seconds`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ${minutes % 60} min`;
    return `${Math.floor(hours / 24)} d ${hours % 24} h`;
  }

  function renderItems(items) {
    itemsList.textContent = '';
    if (!items.length) {
      itemsEmpty.hidden = false;
      itemsEmpty.textContent = 'Nothing has been stopped on this page yet.';
      return;
    }
    itemsEmpty.hidden = true;
    for (const item of items) {
      const li = shared.el('li');
      li.appendChild(shared.el('span', { class: 'ziy-items__url', text: item.url }));
      li.appendChild(shared.el('span', { class: 'ziy-items__cat', text: item.category || 'tracker' }));
      itemsList.appendChild(li);
    }
  }

  function renderSimple() {
    simpleSection.hidden = isAdvanced;
    advancedSection.hidden = !isAdvanced;
    if (!isAdvanced) {
      const rows = ROWS.map(row => {
        const overridden = state.layers && state.layers[row.key] === 'site';
        if (row.kind === 'switch') {
          const r = shared.toggleRow(row, state.rule[row.key], { overridden, disabled: true, reason: COPY.simpleReadOnlyHint });
          return r.wrap;
        }
        if (row.kind === 'segmented') {
          const r = shared.segmentedRow(row, state.rule[row.key], { overridden });
          for (const input of r.group.querySelectorAll('input')) {
            input.setAttribute('aria-disabled', 'true');
            input.disabled = true;
          }
          for (const label of r.group.querySelectorAll('.ziy-segmented__opt')) {
            label.setAttribute('aria-disabled', 'true');
            label.style.opacity = '.6';
            label.style.cursor = 'not-allowed';
          }
          return r.wrap;
        }
        if (row.kind === 'dropdown') {
          const r = shared.dropdownRow(row, state.rule[row.key], { overridden });
          r.select.setAttribute('aria-disabled', 'true');
          r.select.disabled = true;
          return r.wrap;
        }
        return null;
      }).filter(Boolean);
      simpleSection.replaceChildren(
        shared.el('h3', { class: 'ziy-simple__title', id: 'ziy-simple-title', text: COPY.simpleHeading }),
        shared.el('p', { class: 'ziy-simple__hint', id: 'ziy-simple-hint', text: COPY.simpleReadOnlyHint }),
        ...rows,
      );
    } else {
      renderAdvanced();
    }
  }

  function renderAdvanced() {
    advancedSection.replaceChildren();

    const heading = shared.el('h3', { class: 'ziy-advanced__title', id: 'ziy-advanced-title', text: COPY.advancedHeading });
    const container = shared.el('div', { id: 'ziy-rows' });

    for (const row of ROWS) {
      const overridden = state.layers && state.layers[row.key] === 'site';
      if (row.kind === 'switch') {
        const r = shared.toggleRow(row, state.rule[row.key], {
          overridden,
          fingerprinting: state.rule.fpSub,
        });
        r.input.addEventListener('change', () => {
          setSite(row.key, r.input.checked);
        });
        if (row.subToggles) {
          for (const sub of row.subToggles) {
            const radios = container.querySelectorAll(`input[name="ziy-sub-${sub.key}"]`);
            radios.forEach(radio => radio.addEventListener('change', () => {
              if (radio.checked) setSiteSub(sub.key, radio.value);
            }));
          }
        }
        container.appendChild(r.wrap);
      } else if (row.kind === 'segmented') {
        const r = shared.segmentedRow(row, state.rule[row.key], { overridden });
        for (const input of r.group.querySelectorAll('input')) {
          input.addEventListener('change', () => {
            if (input.checked) setSite(row.key, input.value);
          });
        }
        container.appendChild(r.wrap);
      } else if (row.kind === 'dropdown') {
        const r = shared.dropdownRow(row, state.rule[row.key], { overridden });
        r.select.addEventListener('change', () => setSite(row.key, r.select.value));
        container.appendChild(r.wrap);
      }
    }

    const resetBtn = shared.el('button', {
      class: 'ziy-btn ziy-btn--quiet', type: 'button', text: COPY.resetSite,
    });
    resetBtn.addEventListener('click', () => {
      send('shields.clearSite', { domain: state.domain }).then(load);
    });

    advancedSection.replaceChildren(heading, container, resetBtn);
  }

  /* ------------------------------------------------------------------ *
   * Writing per-site rules
   * ------------------------------------------------------------------ */

  async function setSite(key, value) {
    if (!state || !state.domain) return;
    const patch = {};
    if (key === 'fingerprinting') {
      patch.fingerprinting = value === true;
    } else {
      patch[key] = value;
    }
    await send('shields.setSite', { domain: state.domain, patch });
    await load();
  }

  async function setSiteSub(key, triState) {
    if (!state || !state.domain) return;
    // The tri-state sub-toggle is stored on the site rule; the fp master
    // switch is written first so the fingerprint row exists.
    const patch = { fingerprinting: true, [key]: triState };
    await send('shields.setSite', { domain: state.domain, patch });
    await load();
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */

  shutdownBtn.addEventListener('click', async () => {
    if (!state || !state.domain) return;
    const up = state.rule.enabled !== false;
    await send('shields.setSite', { domain: state.domain, patch: { enabled: !up } });
    await load();
  });

  countEl.addEventListener('click', () => {
    const open = itemsSection.hidden;
    itemsSection.hidden = !open;
    countEl.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (countEl.getAttribute('aria-expanded') === 'true') {
        itemsSection.hidden = true;
        countEl.setAttribute('aria-expanded', 'false');
        countEl.focus();
        return;
      }
      window.close();
    }
  });

  // Focus starts on the panel heading (design component #2).
  async function load() {
    const tab = await activeTab();
    const res = await send('shields.state', { tabId: tab ? tab.id : undefined });
    if (!res || res.ok !== true) return;
    state = res.state;
    renderSummary();
    renderCount();
    renderSimple();
  }

  load();
})();
