/* Ziy passwords — the popup's script.
 *
 * WHAT IT READS AND WRITES
 * -----------------------
 * It reads the one bus the background exposes (pwd.* ops over
 * runtime.sendMessage), and it renders exactly what that bus answers. It does
 * not reach into the native helper itself, because a popup is not a permitted
 * context for native messaging on every engine and the background event page is.
 *
 * The honest behaviour the panel is held to:
 *   - a state it does not know is shown as unknown, never as unlocked;
 *   - a password is never rendered: the list shows origin and username, which
 *     is what the recon's S49 list shows, and the only password on screen is
 *     the one the user is typing;
 *   - a form-fill control does not exist, because the feature does not. See
 *     manifest.json's note and replica/proofs-must-gaps.md §GAP 3.
 */

'use strict';

(function () {
  const lib = globalThis.ziyPwd || {};
  const api = (typeof browser !== "undefined") ? browser : chrome;

  const el = (id) => document.getElementById(id);
  const ui = {
    badge: el("ziy-badge"),
    status: el("ziy-status"),
    create: el("ziy-create"),
    createBtn: el("ziy-create-btn"),
    newPass: el("ziy-new-pass"),
    unlock: el("ziy-unlock"),
    unlockBtn: el("ziy-unlock-btn"),
    unlockPass: el("ziy-unlock-pass"),
    lockBtn: el("ziy-lock-btn"),
    main: el("ziy-main"),
    list: el("ziy-list"),
    listLabel: el("ziy-list-label"),
    saveForm: el("ziy-save"),
    saveOrigin: el("ziy-save-origin"),
    saveUser: el("ziy-save-user"),
    savePass: el("ziy-save-pass"),
    importBtn: el("ziy-import-btn"),
    importFile: el("ziy-import-file"),
    exportBtn: el("ziy-export-btn"),
    clearBtn: el("ziy-clear-btn"),
    foot: el("ziy-foot"),
  };

  const state = {
    hasVault: false,
    unlocked: false,
    count: 0,
    credentials: [],
    /** The active tab's origin, so the save form can prefill the site. */
    pageOrigin: null,
  };

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  function send(op, body) {
    return api.runtime.sendMessage({ op, body: body || {} });
  }

  function setStatus(text, isError) {
    ui.status.textContent = text;
    ui.status.classList.toggle("ziy-pwd__error", Boolean(isError));
  }

  function render() {
    // Unknown, not "locked": the status query is the authority, and until it
    // answers the panel says so rather than guessing an unlock state.
    const badge = !state.hasVault
      ? { text: "no vault", cls: "" }
      : state.unlocked
        ? { text: "unlocked", cls: "ziy-pwd__badge--open" }
        : { text: "locked", cls: "ziy-pwd__badge--locked" };
    ui.badge.textContent = badge.text;
    ui.badge.className = "ziy-pwd__badge " + badge.cls;

    ui.create.hidden = state.hasVault;
    ui.unlock.hidden = !state.hasVault;
    ui.main.hidden = !state.unlocked;
    ui.lockBtn.hidden = !state.unlocked;
    // The unlock form is the create form's sibling only while there is no vault.
    if (!state.hasVault) {
      setStatus("Create a passphrase to start the vault.");
      return;
    }
    if (!state.unlocked) {
      setStatus("The vault is locked. Enter your passphrase to see saved logins.");
      return;
    }
    setStatus(`${state.count} saved login${state.count === 1 ? "" : "s"} in this vault.`);
    renderList();
  }

  function renderList() {
    ui.list.textContent = "";
    for (const cred of state.credentials) {
      const li = document.createElement("li");
      li.className = "ziy-pwd__item";
      if (state.pageOrigin && lib.originMatchesPage(cred.origin, state.pageOrigin)) {
        li.classList.add("ziy-pwd__item--current");
      }
      const main = document.createElement("span");
      main.className = "ziy-pwd__item-main";
      const origin = document.createElement("span");
      origin.className = "ziy-pwd__item-origin";
      origin.textContent = cred.origin;
      const user = document.createElement("span");
      user.className = "ziy-pwd__item-user";
      user.textContent = cred.username;
      main.appendChild(origin);
      main.appendChild(user);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ziy-pwd__item-remove";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove the login for ${cred.username} on ${cred.origin}`);
      remove.addEventListener("click", () => removeCredential(cred.id));
      li.appendChild(main);
      li.appendChild(remove);
      ui.list.appendChild(li);
    }
    ui.listLabel.textContent = state.credentials.length
      ? `Saved logins for ${state.pageOrigin || "every site"}`
      : "No saved logins yet";
  }

  /* ------------------------------------------------------------------ *
   * Bus calls
   * ------------------------------------------------------------------ */

  async function refresh() {
    try {
      const res = await send("pwd.state", {});
      if (res && res.ok && res.state) {
        state.hasVault = res.state.hasVault === true;
        state.unlocked = res.state.unlocked === true;
        state.count = res.state.count || 0;
      }
      if (state.unlocked) state.credentials = await listCredentials();
      else state.credentials = [];
      render();
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    }
  }

  async function listCredentials() {
    const res = await send("pwd.list", {});
    return (res && res.credentials) || [];
  }

  async function removeCredential(id) {
    try {
      await send("pwd.remove", { id });
      await refresh();
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    }
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  ui.create.addEventListener("submit", async (event) => {
    event.preventDefault();
    ui.createBtn.disabled = true;
    try {
      await send("pwd.create", { passphrase: ui.newPass.value });
      // The passphrase field is cleared the moment it has been used: the value
      // has no further purpose in this document.
      ui.newPass.value = "";
      await refresh();
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    }
    ui.createBtn.disabled = false;
  });

  ui.unlock.addEventListener("submit", async (event) => {
    event.preventDefault();
    ui.unlockBtn.disabled = true;
    try {
      await send("pwd.unlock", { passphrase: ui.unlockPass.value });
      ui.unlockPass.value = "";
      await refresh();
    } catch (error) {
      setStatus("That passphrase did not unlock the vault.", true);
    }
    ui.unlockBtn.disabled = false;
  });

  ui.lockBtn.addEventListener("click", async () => {
    try {
      await send("pwd.lock", {});
      state.credentials = [];
      state.unlocked = false;
      render();
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    }
  });

  ui.saveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await send("pwd.save", {
        origin: ui.saveOrigin.value,
        username: ui.saveUser.value,
        password: ui.savePass.value,
      });
      ui.savePass.value = "";
      await refresh();
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    }
  });

  ui.importBtn.addEventListener("click", () => ui.importFile.click());

  ui.importFile.addEventListener("change", async () => {
    const file = ui.importFile.files && ui.importFile.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await send("pwd.import", { csv: text });
      const n = (res && res.result && res.result.saved) || 0;
      const skipped = (res && res.result && res.result.skipped) || 0;
      setStatus(`Imported ${n} login${n === 1 ? "" : "s"}${skipped ? `, ${skipped} row(s) skipped` : ""}.`);
      await refresh();
    } catch (error) {
      setStatus("That file is not a password CSV this vault can read.", true);
    }
    ui.importFile.value = "";
  });

  ui.exportBtn.addEventListener("click", async () => {
    try {
      const res = await send("pwd.export", {});
      const csv = (res && res.result && res.result.csv) || "";
      // The export is written to a Blob and downloaded by this document, so the
      // plaintext CSV never touches the filesystem through the helper.
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ziy-passwords.csv";
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${(res.result.count || 0)} login(s).`);
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    }
  });

  ui.clearBtn.addEventListener("click", async () => {
    // A delete-all is confirmed before it runs, because it is not undoable.
    const ok = window.confirm("Delete every saved password in this vault? This cannot be undone.");
    if (!ok) return;
    try {
      await send("pwd.clear", {});
      state.credentials = [];
      await refresh();
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    }
  });

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  async function boot() {
    // The active tab's origin prefill the save form and mark the current site's
    // rows. tabs.query is available in a real popup; if it is not (a page
    // context), the panel still works, just without the site prefill.
    try {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      const url = tabs && tabs[0] && tabs[0].url;
      if (url) {
        const origin = lib.normaliseOrigin(url);
        if (origin) {
          state.pageOrigin = origin;
          ui.saveOrigin.value = origin;
        }
      }
    } catch (e) { /* no tab context: no prefill, still usable */ }
    await refresh();
  }

  boot();
})();
