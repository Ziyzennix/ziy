/* Ziy Shields — the MV3 options page (recon S10, global Shields settings).
 *
 * Reachable from about:addons as `options_page` (the manifest declares both
 * `options_page` and `options_ui`, with open_in_tab so the page is a real tab
 * and not a cramped popup).
 *
 * This page edits the GLOBAL record (shields.global). Its behaviour under §5.3
 * is the important one: writing a row here never rewrites a per-site override,
 * because a per-site rule is stored as an absolute rule resolved against the
 * FACTORY default — not a diff against the global value. So the effect of
 * "Scripts: block" changing to "Scripts: allow" globally is that every site
 * that never chose follows along, and every site that chose stays exactly where
 * it was.
 */

'use strict';

(function () {
  const shared = window.__ziyShieldsShared;
  const COPY = shared.COPY;
  const ROWS = shared.ROWS;
  const api = shared.api;

  const statusEl = document.getElementById('ziy-options-status');
  const rowsEl = document.getElementById('ziy-rows');
  const listsEl = document.getElementById('ziy-lists');
  const listsMetaEl = document.getElementById('ziy-lists-meta');
  const addListForm = document.getElementById('ziy-add-list');
  const addListUrl = document.getElementById('ziy-addlist-url');
  const addListError = document.getElementById('ziy-addlist-error');

  let globalRule = null;
  let registry = null;

  function send(op, body) {
    return api.runtime.sendMessage({ op, body });
  }

  function say(message, isError) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? 'var(--danger)' : 'var(--success)';
    clearTimeout(say._t);
    say._t = setTimeout(() => { statusEl.textContent = ''; }, 4000);
  }

  /* ------------------------------------------------------------------ *
   * Global rows
   * ------------------------------------------------------------------ */

  async function loadGlobal() {
    const res = await send('shields.state', { body: {} });
    const value = await api.storage.local.get(['shields.global']);
    globalRule = value['shields.global'] || null;
    renderGlobal();
  }

  function renderGlobal() {
    rowsEl.textContent = '';
    for (const row of ROWS) {
      const value = globalRule ? globalRule[row.key] : undefined;
      const subs = globalRule ? globalRule.fpSub : undefined;
      if (row.kind === 'switch') {
        const r = shared.toggleRow(row, value, { fingerprinting: subs });
        r.input.addEventListener('change', () => saveGlobal(row.key, row.key === 'fingerprinting' ? r.input.checked : r.input.checked));
        if (row.subToggles) {
          for (const sub of row.subToggles) {
            const group = rowsEl.querySelector(`input[name="ziy-sub-${sub.key}"]`);
          }
        }
        rowsEl.appendChild(r.wrap);
      } else if (row.kind === 'segmented') {
        const r = shared.segmentedRow(row, value, {});
        for (const input of r.group.querySelectorAll('input')) {
          input.addEventListener('change', () => {
            if (input.checked) saveGlobal(row.key, input.value);
          });
        }
        rowsEl.appendChild(r.wrap);
      } else if (row.kind === 'dropdown') {
        const r = shared.dropdownRow(row, value, {});
        r.select.addEventListener('change', () => saveGlobal(row.key, r.select.value));
        rowsEl.appendChild(r.wrap);
      }
    }

    // The sub-radios are inside the rows, so bind them after the DOM exists.
    bindSubRadios();
  }

  function bindSubRadios() {
    for (const row of ROWS) {
      for (const sub of (row.subToggles || [])) {
        const radios = rowsEl.querySelectorAll(`input[name="ziy-sub-${sub.key}"]`);
        radios.forEach(radio => {
          radio.addEventListener('change', () => {
            if (radio.checked) saveGlobalSub(sub.key, radio.value);
          });
        });
      }
    }
  }

  async function saveGlobal(key, value) {
    const current = globalRule || {};
    const patch = {};
    patch[key] = value;
    // The global record is a full rule; a row edit is a merge of one key.
    await api.storage.local.set({ 'shields.global': { ...current, ...patch } });
    await loadGlobal();
    say(COPY.saved);
  }

  async function saveGlobalSub(key, triState) {
    const current = globalRule || {};
    const fpSub = { ...(current.fpSub || {}) };
    fpSub[key] = triState;
    await api.storage.local.set({ 'shields.global': { ...current, fpSub } });
    await loadGlobal();
    say(COPY.saved);
  }

  /* ------------------------------------------------------------------ *
   * Filter lists (S11, F06)
   * ------------------------------------------------------------------ */

  async function loadLists() {
    const res = await send('shields.lists', {});
    registry = res.registry;
    renderLists();
  }

  function renderLists() {
    listsEl.textContent = '';
    let total = 0;
    let checkedAt = 0;
    for (const record of Object.values(registry)) {
      total += record.ruleCount || 0;
      checkedAt = Math.max(checkedAt, record.lastCheckedAt || 0);
      const row = shared.el('div', { class: 'ziy-list' });
      const box = shared.el('input', { type: 'checkbox', id: `ziy-list-${record.id}` });
      box.checked = record.enabled !== false;
      box.addEventListener('change', async () => {
        await send('shields.listEnabled', { id: record.id, enabled: box.checked });
        await loadLists();
        say(box.checked ? `${record.name} is on` : `${record.name} is off`);
      });
      const meta = shared.el('div', {});
      const nameLine = shared.el('span', { class: 'ziy-list__name', text: record.name });
      if (record.licenceUrl || record.homepage) {
        const link = shared.el('a', {
          class: 'ziy-list__link',
          href: record.licenceUrl || record.homepage,
          target: '_blank',
          rel: 'noreferrer noopener',
          text: record.isCustom ? 'source' : 'licence',
        });
        nameLine.appendChild(document.createTextNode(' '));
        nameLine.appendChild(link);
      }
      meta.appendChild(nameLine);
      meta.appendChild(shared.el('div', {
        class: 'ziy-list__meta',
        text: [
          `${(record.ruleCount || 0).toLocaleString()} rules`,
          record.isCustom ? 'your list' : 'ships with Ziy',
          record.licence || 'licence not declared',
          record.sha256 ? `sha256 ${record.sha256.slice(0, 12)}…` : 'no checksum yet',
          COPY.checkedAt(record.lastCheckedAt),
        ].filter(Boolean).join(' · '),
      }));
      const remove = record.isCustom ? shared.el('button', {
        class: 'ziy-btn ziy-btn--quiet', type: 'button', text: 'Remove',
      }) : null;
      if (remove) {
        remove.addEventListener('click', async () => {
          await send('shields.removeList', { id: record.id });
          await loadLists();
          say(`${record.name} removed`);
        });
      }
      row.appendChild(box);
      row.appendChild(meta);
      row.appendChild(remove || shared.el('span', { class: 'ziy-list__meta', text: '' }));
      listsEl.appendChild(row);
    }
    listsMetaEl.textContent = `${total.toLocaleString()} rules in total from ${Object.keys(registry).length} lists`;
  }

  addListForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    addListError.hidden = true;
    const url = addListUrl.value.trim();
    if (!/^https:\/\//i.test(url)) {
      addListError.textContent = COPY.errorFetch;
      addListError.hidden = false;
      addListUrl.setAttribute('aria-invalid', 'true');
      return;
    }
    addListUrl.removeAttribute('aria-invalid');
    const id = new URL(url).hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    try {
      await send('shields.addList', { id, name: id, url });
      addListUrl.value = '';
      await loadLists();
      say(COPY.saved);
    } catch (e) {
      addListError.textContent = COPY.errorFetch;
      addListError.hidden = false;
      addListUrl.setAttribute('aria-invalid', 'true');
    }
  });

  document.getElementById('ziy-update-now').addEventListener('click', async () => {
    const res = await send('shields.rebuild', {});
    await loadLists();
    say(res && res.ok ? COPY.saved : COPY.errorFetch);
  });

  /* ------------------------------------------------------------------ *
   * Theme: follow the shell's [data-theme] convention (tokens.css).
   * ------------------------------------------------------------------ */

  (function applyTheme() {
    try {
      const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      const set = () => {
        document.body.setAttribute('data-theme', mq && mq.matches ? 'dark' : 'light');
      };
      set();
      if (mq && mq.addEventListener) mq.addEventListener('change', set);
    } catch (e) { /* options page renders light if matchMedia is unavailable */ }
  })();

  loadGlobal();
  loadLists();
})();
