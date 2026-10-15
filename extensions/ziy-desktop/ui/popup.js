/* Ziy Desktop — the app menu popup.
 *
 * This is the Ziy menu (recon S13): new tab / window, zoom, find, the engine's
 * own pages, settings, about, plus the desktop-glue rows — import/export,
 * default-browser status, profiles, and the shortcut note.
 *
 * Two rules this page obeys:
 *   1. A control that cannot be real is not a control. Every disabled row
 *      states why, in the row, in words.
 *   2. The engine's pages are opened with their own URLs, not re-implemented
 *      here. History is about:history, not a copy of history.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { menu: null };

  function announce(message) {
    const live = $('menu-live');
    if (live) live.textContent = message;
  }

  function setStatus(message, kind) {
    const el = $('menu-status');
    if (!el) return;
    el.textContent = message;
    el.dataset.kind = kind || 'info';
  }

  async function ask(op, payload) {
    try {
      const reply = await browser.runtime.sendMessage({ op, ...(payload || {}) });
      if (reply && reply.ok === false) throw new Error(reply.error || 'the action was refused');
      return reply;
    } catch (error) {
      setStatus(String((error && error.message) || error), 'error');
      announce(String((error && error.message) || error));
      return null;
    }
  }

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */

  function renderZoom(menu) {
    const row = $('zoom-row');
    const value = $('zoom-value');
    if (!menu.engine.zoom) {
      row.hidden = true;
      const note = $('note-zoom');
      note.hidden = false;
      note.querySelector('.menu-row__why').textContent =
        'this engine build exposes no tabs.setZoom, so the zoom controls are hidden rather than offered dead';
      return;
    }
    value.textContent = menu.zoomFormatted || '100%';
    $('zoom-in').disabled = menu.zoom !== null && menu.zoom >= 3.0;
    $('zoom-out').disabled = menu.zoom !== null && menu.zoom <= 0.3;
  }

  function renderDefaultBrowser(menu) {
    const row = $('default-browser-row');
    const detail = $('default-browser-detail');
    const status = menu.defaultBrowser;
    if (!status) {
      row.hidden = true;
      return;
    }
    row.hidden = false;
    if (status.state === 'ziy') {
      detail.textContent = 'Yes — the desktop session names Ziy';
      row.dataset.state = 'ziy';
    } else if (status.state === 'other') {
      detail.textContent = `No — it names ${status.current}`;
      row.dataset.state = 'other';
    } else {
      detail.textContent = 'Unknown — no helper answered';
      row.dataset.state = 'unknown';
    }
  }

  function renderProfiles(menu) {
    const row = $('profiles-row');
    const detail = $('profiles-detail');
    const select = $('profiles-select');
    const profiles = menu.profiles;
    if (!profiles) { row.hidden = true; return; }
    row.hidden = false;
    detail.textContent = profiles.current
      ? `Current profile: ${profiles.current}`
      : 'Current profile: default';
    select.textContent = '';
    const names = profiles.names && profiles.names.length ? profiles.names : (profiles.current ? [profiles.current] : ['default']);
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name + (name === profiles.current ? ' (current)' : '');
      select.appendChild(option);
    }
    // Switching a profile restarts the browser with --profile, which only the
    // launcher can do. The select is therefore a command generator, and it says
    // so, rather than pretending it switched anything.
    $('profiles-switch').textContent = `Copy the command for "${select.value}"`;
  }

  function renderEngineNotes(menu) {
    const notes = [];
    if (!menu.engine.privateWindow) {
      notes.push({
        id: 'note-private-window',
        text: 'A private window needs the engine\'s own path: Ctrl+Shift+P, or the application menu. windows.create has no private flag on this engine, so this menu does not offer a button that cannot work.',
      });
    }
    if (!menu.engine.find) {
      notes.push({ id: 'note-find', text: 'This engine build exposes no browser.find. The engine\'s own find bar (Ctrl+F) is the path.' });
    }
    if (!menu.engine.downloads) {
      notes.push({ id: 'note-export', text: 'This engine build exposes no downloads API, so export cannot write a file.' });
    }
    if (!menu.engine.zoom) {
      notes.push({ id: 'note-zoom', text: 'This engine build exposes no tabs.setZoom, so the zoom controls are hidden rather than offered dead.' });
    }
    const host = document.getElementById('engine-notes');
    host.textContent = '';
    for (const note of notes) {
      const li = document.createElement('li');
      li.className = 'menu-note';
      li.id = note.id;
      li.textContent = note.text;
      host.appendChild(li);
    }
    host.hidden = notes.length === 0;
  }

  /* ---------------------------------------------------------------- *
   * The actions
   * ---------------------------------------------------------------- */

  async function refresh() {
    const reply = await ask('desktop.menu.state');
    if (!reply) return;
    state.menu = reply.state;
    renderZoom(state.menu);
    renderDefaultBrowser(state.menu);
    renderProfiles(state.menu);
    renderEngineNotes(state.menu);
    if (state.menu.defaultBrowser && state.menu.defaultBrowser.state === 'ziy') {
      $('set-default').hidden = true;
    }
  }

  function bind(id, handler) {
    const el = $(id);
    if (el) el.addEventListener('click', handler);
  }

  bind('new-tab', () => ask('desktop.new-tab').then((r) => { if (r) window.close(); }));
  bind('new-window', () => ask('desktop.new-window').then((r) => { if (r) window.close(); }));
  bind('zoom-in', () => ask('desktop.zoom', { level: 'in' }).then(refresh));
  bind('zoom-out', () => ask('desktop.zoom', { level: 'out' }).then(refresh));
  bind('zoom-reset', () => ask('desktop.zoom', { level: 'reset' }).then(refresh));

  bind('find-open', () => {
    const query = $('find-query').value;
    if (!query.trim()) {
      setStatus('Type something to find.', 'error');
      $('find-query').focus();
      return;
    }
    ask('desktop.find', { query }).then((reply) => {
      if (reply && reply.result && typeof reply.result.count === 'number') {
        setStatus(`${reply.result.count} match${reply.result.count === 1 ? '' : 'es'} in this page.`, 'ok');
      }
    });
  });

  bind('open-history', () => ask('desktop.open-page', { page: 'history' }));
  bind('open-downloads', () => ask('desktop.open-page', { page: 'downloads' }));
  bind('open-bookmarks', () => ask('desktop.open-page', { page: 'bookmarks' }));
  bind('open-settings', () => ask('desktop.open-page', { page: 'settings' }));

  bind('import-start', () => ask('desktop.import.bookmarks').then((reply) => {
    if (!reply) return;
    if (reply.cancelled) { setStatus('Import cancelled. Nothing was changed.', 'info'); return; }
    const r = reply.result || {};
    setStatus(`Imported from ${reply.source}: ${r.bookmarks || 0} bookmarks, ${r.folders || 0} folders.`, 'ok');
  }));

  bind('export-bookmarks', () => ask('desktop.export.bookmarks').then((reply) => {
    if (reply) setStatus(`Saved ${reply.filename}.`, 'ok');
  }));

  bind('export-snapshot', () => ask('desktop.export.snapshot').then((reply) => {
    if (reply) setStatus(`Saved ${reply.filename}.`, 'ok');
  }));

  bind('restore-snapshot', () => ask('desktop.import.snapshot').then((reply) => {
    if (!reply) return;
    if (reply.cancelled) { setStatus('Restore cancelled. Nothing was changed.', 'info'); return; }
    setStatus(`Settings restored from the snapshot.`, 'ok');
  }));

  bind('copy-default-command', () => navigator.clipboard.writeText('xdg-settings set default-web-browser ziy.desktop')
    .then(() => setStatus('Copied the command. Run it in a terminal, then reopen this menu.', 'ok'))
    .catch(() => setStatus('Could not reach the clipboard. The command: xdg-settings set default-web-browser ziy.desktop', 'error')));

  $('profiles-select').addEventListener('change', (event) => {
    $('profiles-switch').textContent = `Copy the command for "${event.target.value}"`;
  });

  bind('profiles-switch', () => {
    const name = $('profiles-select').value;
    const command = `tools/ziy --profile ${name}`;
    navigator.clipboard.writeText(command)
      .then(() => setStatus(`Copied: ${command} — run it from the Ziy repo to open this profile.`, 'ok'))
      .catch(() => setStatus(`The command: ${command}`, 'error'));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
  });

  refresh().catch((error) => setStatus(String(error && error.message || error), 'error'));
})();
