/* Ziy Playlist — the options page (the full settings surface, S43's
 * "Settings - Playlist").
 *
 * The panel has the same rows, because there is one settings model and two
 * views. This page exists because the panel's rows are convenient, not
 * complete: the per-site prompt list, the honest notes about what a choice
 * can and cannot do, and the reset with its consequences are all here.
 *
 * Like every Ziy page, it owns no fetch of its own and keeps no storage of
 * its own: it talks to the event page over runtime.sendMessage and the event
 * page is the only writer.
 */
(function () {
  "use strict";

  const settingsModel = globalThis.ZiyPlaylistSettings;

  const api = typeof browser !== "undefined" ? browser : chrome;

  const COPY = Object.freeze({
    saved: "Playlist settings saved.",
    resetTitle: "Reset your playlist",
    resetBody:
      "This removes every item in the queue and every remembered position. You cannot " +
      "undo it.",
    resetConfirm: "Reset the queue",
    resetDone: "Playlist reset. The queue is empty.",
    siteRemoved: "That site will be asked again.",
    listTitle: "Sites you dismissed the prompt on",
    listEmpty: "You have not dismissed the prompt on any site.",
    backgroundTitle: "What playback can and cannot do here",
    backgroundBody:
      "Playback lives in the panel, and the panel is the player. When you close the panel, " +
      "playback pauses and your place is kept. The reference keeps playing with its window " +
      "closed because its player is a browser-side process; this engine gives an extension " +
      "no such process, so a switch claiming that behaviour would be lying to you.",
    hlsTitle: "Streams",
    hlsBody:
      "An HLS manifest is one queue item and the panel resolves it with the browser's own " +
      "media stack. Live manifests are not supported: this engine's streams resolve from the " +
      "start, and a live one has no start. Such an item opens in a tab instead.",
    qualityTitle: "Quality is a note",
    qualityBody:
      "Choosing a variant is adaptive bitrate switching, which needs a switcher this engine " +
      "does not have. Your preference is recorded and the manifest's first variant plays. A " +
      "selector that promised otherwise would be a control that does nothing.",
  });

  const els = {};
  for (const id of [
    "options-status",
    "setting-speed", "setting-sleep", "setting-resume", "setting-side", "setting-prompt",
    "setting-quality",
    "site-list", "site-empty",
    "reset-dialog", "reset-confirm-text", "btn-reset-open", "btn-reset", "btn-reset-cancel",
  ]) {
    els[id] = document.getElementById(id);
  }

  const state = {
    settings: settingsModel.factorySettings(),
    sites: {},
  };

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function announce(text) {
    els["options-status"].textContent = "";
    setTimeout(function () {
      els["options-status"].textContent = text;
    }, 0);
  }

  function message(op, payload) {
    return api.runtime.sendMessage(Object.assign({ op: op, from: "ui" }, payload || {}));
  }

  async function load() {
    try {
      const settings = await message("playlist.settings.get");
      state.settings = settingsModel.normaliseSettings(settings.settings);
      renderSettings();
      await loadSites();
    } catch (err) {
      announce("The settings could not be read, so the defaults are showing.");
    }
  }

  function renderSettings() {
    els["setting-speed"].value = String(state.settings.defaultSpeed);
    els["setting-sleep"].value = String(state.settings.sleepTimerMinutes);
    els["setting-resume"].value = state.settings.resumeMode;
    els["setting-side"].value = state.settings.panelSide;
    els["setting-prompt"].value = state.settings.autoAddPrompt ? "on" : "off";
    els["setting-quality"].value = state.settings.mediaQuality;
  }

  async function loadSites() {
    const reply = await message("playlist.sites.get");
    state.sites = settingsModel.normaliseSites(reply.sites);
    renderSites();
  }

  function renderSites() {
    const list = els["site-list"];
    list.textContent = "";
    const keys = Object.keys(state.sites);
    els["site-empty"].hidden = keys.length > 0;
    for (const key of keys) {
      const li = document.createElement("li");
      li.className = "site-row";
      const label = document.createElement("span");
      label.className = "site-row__label";
      label.textContent = key;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pl-btn pl-btn--quiet";
      button.textContent = "Ask on this site again";
      button.dataset.site = key;
      button.addEventListener("click", function () {
        void message("playlist.site.undismiss", { origin: key }).then(function () {
          return loadSites();
        }).then(function () {
          announce(COPY.siteRemoved);
        });
      });
      li.append(label, button);
      list.appendChild(li);
    }
  }

  function save() {
    const next = settingsModel.patch(state.settings, {
      defaultSpeed: Number(els["setting-speed"].value) || 1,
      sleepTimerMinutes: Number(els["setting-sleep"].value) || 0,
      resumeMode: els["setting-resume"].value,
      panelSide: els["setting-side"].value,
      autoAddPrompt: els["setting-prompt"].value === "on",
      mediaQuality: els["setting-quality"].value,
    });
    state.settings = next;
    void message("playlist.settings.set", { settings: next }).then(function () {
      announce(COPY.saved);
    }).catch(function () {
      announce("Those settings could not be saved.");
    });
  }

  function bind() {
    for (const id of ["setting-speed", "setting-sleep", "setting-resume", "setting-side",
                      "setting-prompt", "setting-quality"]) {
      els[id].addEventListener("change", save);
    }

    /* The reset is a <dialog>: the native focus trap and Esc come free, and
       the destructive button names its consequence rather than saying "OK". */
    els["btn-reset-open"].addEventListener("click", function () {
      if (typeof els["reset-dialog"].showModal === "function") {
        els["reset-dialog"].showModal();
      } else {
        els["reset-dialog"].hidden = false;
      }
    });
    els["btn-reset"].addEventListener("click", function () {
      if (els["reset-confirm-text"].value.trim().toLowerCase() !== "reset") {
        els["btn-reset"].disabled = true;
        return;
      }
      void message("playlist.clear").then(function (reply) {
        if (reply && reply.ok === true) {
          announce(COPY.resetDone);
          if (typeof els["reset-dialog"].close === "function") els["reset-dialog"].close();
        }
      }).catch(function () {
        announce("The queue could not be reset.");
      });
    });
    els["btn-reset-cancel"].addEventListener("click", function () {
      if (typeof els["reset-dialog"].close === "function") els["reset-dialog"].close();
      else els["reset-dialog"].hidden = true;
    });
    els["reset-confirm-text"].addEventListener("input", function () {
      els["btn-reset"].disabled =
        els["reset-confirm-text"].value.trim().toLowerCase() !== "reset";
    });
  }

  ready(function () {
    bind();
    load();
  });
})();
