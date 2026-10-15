/* Ziy Desktop — the options page: engine facts, shortcuts, the reserved-key
 * list, and the import/export surface. Nothing here is a claim: the capability
 * list is probed from the running engine and the shortcut table is read from
 * browser.commands.getAll(), which reports the keys Gecko actually bound.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CAPABILITIES = [
    ['New windows', 'engine.newWindow', 'browser.windows.create'],
    ['New tabs', 'engine.createTab', 'browser.tabs.create'],
    ['Zoom', 'engine.zoom', 'browser.tabs.setZoom'],
    ['Programmatic find', 'engine.find', 'browser.find.find'],
    ['Write a file (export)', 'engine.downloads', 'browser.downloads.download'],
    ['Native helper', 'engine.nativeMessaging', 'browser.runtime.connectNative'],
  ];
  const MISSING_EXPLANATION = {
    'engine.newWindow': 'No windows API in this build, so the menu cannot open a window.',
    'engine.createTab': 'No tabs API in this build, which would break most of the product.',
    'engine.zoom': 'No tabs.setZoom in this build, so the zoom controls are hidden rather than dead.',
    'engine.find': 'No browser.find in this build. The engine\'s own find bar (Ctrl+F) is the path.',
    'engine.downloads': 'No downloads API, so export cannot write a file, and the export rows are hidden.',
    'engine.nativeMessaging': 'No nativeMessaging, so the default-browser read and the profile read are unavailable and the status is unknown.',
  };

  function announce(message) { $('options-live').textContent = message; }
  function setStatus(message, kind) {
    $('options-status').textContent = message;
    $('options-status').dataset.kind = kind || 'info';
  }

  async function ask(op, payload) {
    try {
      const reply = await browser.runtime.sendMessage({ op, ...(payload || {}) });
      if (reply && reply.ok === false) throw new Error(reply.error || 'refused');
      return reply;
    } catch (error) {
      setStatus(String((error && error.message) || error), 'error');
      return null;
    }
  }

  function renderCapabilities(engine) {
    const list = $('capability-list');
    list.textContent = '';
    for (const [label, key, api] of CAPABILITIES) {
      const ok = !!engine[key];
      const li = document.createElement('li');
      li.className = 'capability__row';
      li.dataset.state = ok ? 'yes' : 'no';
      const dot = document.createElement('span');
      dot.className = 'capability__mark';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = ok ? '✓' : '—';
      const name = document.createElement('span');
      name.className = 'capability__name';
      name.textContent = label;
      const detail = document.createElement('span');
      detail.className = 'capability__api';
      detail.textContent = ok ? api : MISSING_EXPLANATION[key] || 'not available';
      li.append(dot, name, detail);
      list.appendChild(li);
    }
  }

  async function renderShortcuts() {
    const body = $('shortcuts-body');
    body.textContent = '';
    let commands = [];
    try {
      commands = await browser.commands.getAll();
    } catch {
      commands = [];
    }
    if (!commands.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'No commands are reported by this build.';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    for (const command of commands) {
      const tr = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = command.description || command.name;
      const key = document.createElement('td');
      const shortcut = command.shortcut || (command.suggested_key && command.suggested_key.default) || '—';
      key.textContent = shortcut;
      key.className = 'shortcuts__key';
      const bound = document.createElement('td');
      const isBound = !!command.shortcut;
      bound.textContent = isBound ? 'Yes' : 'No — the engine keeps this key';
      bound.dataset.bound = isBound ? 'yes' : 'no';
      tr.append(name, key, bound);
      body.appendChild(tr);
    }
    announce(`Loaded ${commands.length} commands.`);
  }

  function renderReserved(reserved) {
    const list = $('reserved-list');
    list.textContent = '';
    for (const key of reserved) {
      const li = document.createElement('li');
      li.textContent = key;
      list.appendChild(li);
    }
  }

  async function renderDefaultBrowser() {
    const host = $('default-browser-body');
    host.textContent = '';
    const reply = await ask('desktop.default-browser.status');
    const guidance = reply && reply.guidance;
    const headline = document.createElement('p');
    headline.className = 'default__headline';
    headline.textContent = guidance ? guidance.headline : 'Default browser: unknown';
    const body = document.createElement('p');
    body.className = 'default__body';
    body.textContent = guidance ? guidance.body : 'No helper answered.';
    host.append(headline, body);
    if (guidance && guidance.action) {
      const button = document.createElement('button');
      button.className = 'button';
      button.type = 'button';
      button.textContent = guidance.action.label;
      button.addEventListener('click', () => navigator.clipboard.writeText(guidance.action.command)
        .then(() => setStatus('Copied the command to the clipboard.', 'ok'))
        .catch(() => setStatus(`The command: ${guidance.action.command}`, 'error')));
      host.appendChild(button);
      const explanation = document.createElement('p');
      explanation.className = 'default__why';
      explanation.textContent = guidance.action.explanation;
      host.appendChild(explanation);
    }
  }

  function bind(id, handler) {
    const el = $(id);
    if (el) el.addEventListener('click', handler);
  }

  bind('import-start', () => ask('desktop.import.bookmarks').then((reply) => {
    if (!reply) return;
    if (reply.cancelled) { setStatus('Import cancelled. Nothing was changed.', 'info'); return; }
    const r = reply.result || {};
    setStatus(`Imported from ${reply.source}: ${r.bookmarks || 0} bookmarks, ${r.folders || 0} folders.`, 'ok');
  }));
  bind('export-bookmarks', () => ask('desktop.export.bookmarks').then((r) => r && setStatus(`Saved ${r.filename}.`, 'ok')));
  bind('export-snapshot', () => ask('desktop.export.snapshot').then((r) => r && setStatus(`Saved ${r.filename}.`, 'ok')));
  bind('restore-snapshot', () => ask('desktop.import.snapshot').then((reply) => {
    if (!reply) return;
    if (reply.cancelled) { setStatus('Restore cancelled. Nothing was changed.', 'info'); return; }
    setStatus('Settings restored from the snapshot.', 'ok');
  }));

  // The engine facts and the reserved-key list come from the background's
  // probe, so the page and the menu always agree on what is real.
  ask('desktop.menu.state').then(async (reply) => {
    if (reply && reply.state) renderCapabilities(reply.state.engine);
    // The reserved-key list is part of the shared lib; read it through the
    // message bus so the page never carries a second copy of the list.
    const reserved = await ask('desktop.reserved-keys');
    renderReserved((reserved && reserved.keys) || []);
    await renderShortcuts();
    await renderDefaultBrowser();
  });
})();
