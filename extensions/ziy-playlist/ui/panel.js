/* Ziy Playlist — the sidebar panel, which IS the player.
 *
 * Rules this file exists to keep:
 *
 *  1. DOMAIN DECISIONS LIVE IN lib/. What an item is, whether a URL is
 *     playable, what a resume sentence says, whether the sleep timer has
 *     fired — every one of those is a lib/ function. This file renders,
 *     listens and forwards, and never re-decides any of them.
 *
 *  2. THE EVENT PAGE OWNS THE QUEUE. Every mutation goes over
 *     runtime.sendMessage; nothing is computed here and stored locally.
 *     One writer means two panels cannot disagree, and a restart cannot leave
 *     a half-applied reorder.
 *
 *  3. NOTHING RUNS WHEN NOTHING IS PLAYING. The panel has exactly two
 *     timers: the sleep-timer tick (armed only while a timer is running) and
 *     the position save (armed only while playing). When the player is idle,
 *     the panel does nothing at all.
 *
 *  4. HONEST LIMITATIONS ARE STATED IN THE UI. The note under the player
 *     names what is not available and why, in the panel, where the user is.
 *     It is not a footnote in a doc the user never opens.
 */
(function () {
  "use strict";

  const model = globalThis.ZiyPlaylistModel;
  const classify = globalThis.ZiyPlaylistClassify;
  const settingsModel = globalThis.ZiyPlaylistSettings;
  const sleepModel = globalThis.ZiyPlaylistSleep;
  const positionModel = globalThis.ZiyPlaylistPosition;

  const api = typeof browser !== "undefined" ? browser : chrome;

  /* ------------------------------------------------------------------ *
   * Copy, Ziy-voiced, in one place.
   * ------------------------------------------------------------------ */
  const COPY = Object.freeze({
    nothingPlaying: "Nothing playing yet",
    empty:
      "Nothing is queued yet. Open a page that is playing something and use the prompt " +
      "beside the player, or the Ziy Playlist button in the toolbar.",
    backgroundNote:
      "Playback lives in this panel. When the panel closes, playback pauses and your " +
      "place is kept — the reference keeps playing outside the window because it runs " +
      "a background process, which this engine does not give an extension.",
    hlsNote:
      "This is a stream manifest. This engine plays the manifest on its own; if it " +
      "refuses it, the item opens in a tab where the site's own player can take it.",
    pageNote: "This is a page, not a file. It opens in a tab.",
    notPlayable: "This item cannot be played here. Open it in a tab instead.",
    removed: "Item removed from your queue.",
    cleared: "Queue cleared. Remembered positions are gone too.",
    moved: function (title, direction) {
      return title + " moved " + direction + ".";
    },
    seekAnnounce: function (time) {
      return "At " + time + ".";
    },
    resumed: "Picked up where you stopped.",
    started: "Playing from the beginning.",
    speedAnnounce: function (rate) {
      return "Speed " + rate + ".";
    },
    sleepStarted: function (minutes) {
      return "Sleep timer set for " + minutes + " minute" + (minutes === 1 ? "" : "s") + ".";
    },
    sleepCancelled: "Sleep timer cancelled.",
    pipUnsupported:
      "This build has no floating-window support for extension pages, so PiP is shown as unavailable.",
    resetDone: "Playlist reset.",
  });

  /* ------------------------------------------------------------------ *
   * Element handles
   * ------------------------------------------------------------------ */
  const els = {};
  for (const id of [
    "playlist-live", "player-video", "player-audio", "player-item-title", "player-item-source",
    "player-elapsed", "player-duration", "player-seek", "btn-back15", "btn-play", "btn-forward15",
    "btn-speed", "btn-sleep", "btn-pip", "btn-fullscreen", "player-volume", "player-volume-value",
    "player-sleep", "player-sleep-text", "btn-sleep-cancel", "player-note",
    "queue-list", "queue-empty", "queue-error", "btn-clear",
    "btn-settings", "btn-help", "settings-body", "help-body",
    "setting-speed", "setting-sleep", "setting-resume", "setting-side", "setting-prompt",
    "setting-quality", "btn-reset",
  ]) {
    els[id] = document.getElementById(id);
  }

  /* ------------------------------------------------------------------ *
   * State.
   *
   * `rows` is what the event page sends back (the queue plus each row's
   * resume sentence). `index` is the selected row. `settings` is always a
   * normalised record, never whatever storage last held.
   * ------------------------------------------------------------------ */
  const state = {
    rows: [],
    index: -1,
    settings: settingsModel.factorySettings(),
    sleep: sleepModel.off(),
    sleepTimerId: 0,
    positionTimerId: 0,
    speedStep: 0,
    playing: false,
    dragging: false,
    loaded: false,
  };

  /* The element that is the player: video when the item is video, audio
     otherwise. One is always hidden; the active one is assigned the src. */
  function playerFor(row) {
    if (!row) return els["player-video"];
    return row.type === "video" ? els["player-video"] : els["player-audio"];
  }

  function currentRow() {
    return state.index >= 0 && state.index < state.rows.length ? state.rows[state.index] : null;
  }

  /* ------------------------------------------------------------------ *
   * Plumbing
   * ------------------------------------------------------------------ */
  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function announce(message) {
    els["playlist-live"].textContent = "";
    setTimeout(function () {
      els["playlist-live"].textContent = message;
    }, 0);
  }

  function message(op, payload) {
    return api.runtime.sendMessage(Object.assign({ op: op, from: "ui" }, payload || {}));
  }

  function showError(text) {
    const box = els["queue-error"];
    box.textContent = text || "";
    box.hidden = !text;
  }

  /* ------------------------------------------------------------------ *
   * Loading
   * ------------------------------------------------------------------ */
  async function load() {
    try {
      const [queue, settings] = await Promise.all([
        message("playlist.get"),
        message("playlist.settings.get"),
      ]);
      state.rows = queue && queue.ok === true && Array.isArray(queue.queue) ? queue.queue : [];
      state.settings = settingsModel.normaliseSettings(
        settings && settings.settings ? settings.settings : settingsModel.factorySettings());
      state.loaded = true;
      render();
    } catch (err) {
      // The panel still renders: an unreadable queue is a state to show, not
      // a reason to leave the panel blank and unlabelled.
      state.rows = [];
      state.loaded = true;
      render();
      showError("The queue could not be read, so the panel is showing nothing.");
    }
  }

  /* ------------------------------------------------------------------ *
   * Rendering: the queue list
   * ------------------------------------------------------------------ */
  function render() {
    renderList();
    renderSettings();
    renderPlayerState();
  }

  function renderList() {
    const list = els["queue-list"];
    list.textContent = "";
    els["queue-empty"].hidden = state.rows.length > 0;
    els["btn-clear"].disabled = state.rows.length === 0;
    for (let i = 0; i < state.rows.length; i += 1) {
      list.appendChild(rowElement(state.rows[i], i));
    }
  }

  function rowElement(row, index) {
    const li = document.createElement("li");
    li.className = "queue__row";
    li.dataset.id = row.id;
    li.dataset.index = String(index);
    if (index === state.index) li.classList.add("queue__row--active");
    li.setAttribute("aria-current", index === state.index ? "true" : "false");

    /* The row's whole surface is the play button, so the hit target is the
       row rather than a sliver of title text. */
    const play = document.createElement("button");
    play.type = "button";
    play.className = "queue__play";
    play.dataset.action = "play";
    play.setAttribute("aria-label",
      playLabel(row, index));
    play.appendChild(thumbElement(row));
    const text = document.createElement("span");
    text.className = "queue__text";
    const title = document.createElement("span");
    title.className = "queue__row-title";
    title.textContent = row.title || "Untitled item";
    const meta = document.createElement("span");
    meta.className = "queue__row-meta";
    meta.textContent = rowMeta(row);
    const resume = document.createElement("span");
    resume.className = "queue__row-resume";
    resume.textContent = resumeText(row);
    text.append(title, meta, resume);
    play.append(text);

    /* The per-row actions. Two real buttons, both with names. */
    const actions = document.createElement("span");
    actions.className = "queue__row-actions";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "pl-btn pl-btn--icon";
    up.dataset.action = "up";
    up.textContent = "↑";
    up.setAttribute("aria-label", "Move " + (row.title || "this item") + " up the queue");
    up.disabled = index === 0;

    const down = document.createElement("button");
    down.type = "button";
    down.className = "pl-btn pl-btn--icon";
    down.dataset.action = "down";
    down.textContent = "↓";
    down.setAttribute("aria-label", "Move " + (row.title || "this item") + " down the queue");
    down.disabled = index === state.rows.length - 1;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "pl-btn pl-btn--icon";
    remove.dataset.action = "remove";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", "Remove " + (row.title || "this item") + " from the queue");
    remove.dataset.confirm = "true";

    actions.append(up, down, remove);
    li.append(play, actions);

    /* Drag reorder. Keyboard reorder is the same move through the keyboard
       handler, so neither path can do something the other cannot. */
    li.draggable = true;
    li.addEventListener("dragstart", onDragStart);
    li.addEventListener("dragover", onDragOver);
    li.addEventListener("drop", onDrop);
    li.addEventListener("dragend", onDragEnd);
    return li;
  }

  function thumbElement(row) {
    const span = document.createElement("span");
    span.className = "queue__thumb";
    if (row.thumbnail) {
      const img = document.createElement("img");
      img.src = row.thumbnail;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", function () {
        /* A poster that 404s leaves a broken frame; the type badge stands in
           rather than an empty box. */
        img.remove();
        const badge = document.createElement("span");
        badge.className = "queue__thumb-badge";
        badge.textContent = row.type === "video" ? "▶" : "♪";
        span.appendChild(badge);
      });
      span.appendChild(img);
    } else {
      const badge = document.createElement("span");
      badge.className = "queue__thumb-badge";
      badge.textContent = row.type === "video" ? "▶" : "♪";
      span.appendChild(badge);
    }
    return span;
  }

  function playLabel(row, index) {
    const name = row.title || "Untitled item";
    const where = index === state.index ? " (playing)" : "";
    if (row.kind === "page") return "Open " + name + " in a tab" + where;
    return "Play " + name + where;
  }

  function rowMeta(row) {
    const bits = [];
    if (row.source && row.source.host) bits.push(row.source.host);
    if (row.duration > 0) bits.push(positionModel.formatTime(row.duration));
    if (row.kind === "page") bits.push("page");
    else if (row.mime) bits.push(row.mime.split(";")[0]);
    return bits.join(" · ");
  }

  function resumeText(row) {
    if (row.kind === "page") return "opens in a tab";
    if (row.finished === true) return "play again";
    if (row.position > 0) return "resume " + positionModel.formatTime(row.position);
    return "not played yet";
  }

  /* ------------------------------------------------------------------ *
   * Rendering: settings into the panel's own rows
   * ------------------------------------------------------------------ */
  function renderSettings() {
    els["setting-speed"].value = String(state.settings.defaultSpeed);
    els["setting-sleep"].value = String(state.settings.sleepTimerMinutes);
    els["setting-resume"].value = state.settings.resumeMode;
    els["setting-side"].value = state.settings.panelSide;
    els["setting-prompt"].value = state.settings.autoAddPrompt ? "on" : "off";
    els["setting-quality"].value = state.settings.mediaQuality;
  }

  /* ------------------------------------------------------------------ *
   * The player
   * ------------------------------------------------------------------ */
  function renderPlayerState() {
    const row = currentRow();
    els["btn-play"].setAttribute("aria-pressed", state.playing ? "true" : "false");
    els["btn-play"].textContent = state.playing ? "Pause" : "Play";
    els["btn-pip"].disabled = typeof document.createElement("video").requestPictureInPicture !== "function";
    els["btn-pip"].setAttribute("aria-disabled",
      els["btn-pip"].disabled ? "true" : "false");
    if (els["btn-pip"].disabled) {
      els["btn-pip"].setAttribute("aria-label", COPY.pipUnsupported);
    }
    if (!row) {
      els["player-item-title"].textContent = COPY.nothingPlaying;
      els["player-item-source"].textContent = "";
      els["player-video"].removeAttribute("src");
      els["player-audio"].removeAttribute("src");
      els["player-video"].hidden = false;
      els["player-audio"].hidden = true;
      // The empty state still says what playback is, because that is the
      // state a first-time user meets, and the honest limitation belongs
      // where they are rather than after they have already tried.
      setNote(COPY.backgroundNote);
      return;
    }
    els["player-item-title"].textContent = row.title || "Untitled item";
    els["player-item-source"].textContent = row.source && row.source.host
      ? "From " + row.source.host
      : "";
    setNote(noteFor(row));
  }

  function noteFor(row) {
    if (row.kind === "page") return COPY.pageNote;
    if (/x-mpegurl|mpegurl|m3u8/i.test(row.mime || "")) return COPY.hlsNote;
    return COPY.backgroundNote;
  }

  function setNote(text) {
    const note = els["player-note"];
    note.textContent = text || "";
    note.hidden = !text;
  }

  /** Loads a row into the media element and starts at its resume point. */
  function selectRow(index, options) {
    const opts = options || {};
    if (index < 0 || index >= state.rows.length) return;
    state.index = index;
    const row = state.rows[index];
    renderList();
    renderPlayerState();

    if (row.kind === "page") {
      // A page item has no timeline: it opens, and the queue keeps the pointer.
      void api.tabs.create({ url: row.url });
      announce(row.title + " opened in a tab.");
      state.index = -1;
      renderList();
      renderPlayerState();
      return;
    }

    const player = playerFor(row);
    els["player-video"].hidden = player !== els["player-video"];
    els["player-audio"].hidden = player !== els["player-audio"];
    player.src = row.url;
    player.playbackRate = state.settings.defaultSpeed;
    els["btn-speed"].textContent = formatSpeed(player.playbackRate);

    const start = row.position > 0 && state.settings.resumeMode !== "never" ? row.position : 0;
    // The position is applied when the metadata is known: seeking before
    // that is silently ignored by a media element, which looks like a bug.
    const applyStart = function () {
      player.removeEventListener("loadedmetadata", applyStart);
      if (start > 0) {
        try {
          player.currentTime = start;
          announce(COPY.resumed);
        } catch (_e) {
          /* A stream that cannot seek yet simply plays from the start. */
        }
      }
    };
    player.addEventListener("loadedmetadata", applyStart);

    if (opts.play !== false) {
      void player.play().then(
        function () {
          state.playing = true;
          void markPlayedNow(row);
          renderPlayerState();
          armPositionSaving();
        },
        function () {
          state.playing = false;
          renderPlayerState();
          showError(COPY.notPlayable);
        }
      );
    }
  }

  function formatSpeed(rate) {
    const n = Number(rate) || 1;
    return n === 1 ? "1×" : n + "×";
  }

  function markPlayedNow(row) {
    void message("playlist.played", { id: row.id, now: Date.now() }).then(function () {
      state.rows = state.rows.map(function (entry) {
        return entry.id === row.id ? Object.assign({}, entry, { lastPlayedAt: Date.now() }) : entry;
      });
    }).catch(function () { /* the row stays; playing is not transactional with logging */ });
  }

  /* ------------------------------------------------------------------ *
   * The transport controls
   * ------------------------------------------------------------------ */
  function activePlayer() {
    const row = currentRow();
    if (!row) return null;
    return playerFor(row);
  }

  function togglePlay() {
    const player = activePlayer();
    if (!player) {
      // Nothing selected: play the first playable row, which is what the
      // play button should do rather than look broken.
      const first = state.rows.findIndex(function (row) { return row.kind !== "page"; });
      if (first >= 0) selectRow(first);
      return;
    }
    if (player.paused) {
      void player.play().then(function () {
        state.playing = true;
        renderPlayerState();
        armPositionSaving();
      }).catch(function () {
        showError(COPY.notPlayable);
      });
    } else {
      player.pause();
      state.playing = false;
      renderPlayerState();
      savePositionNow();
    }
  }

  function skip(seconds) {
    const player = activePlayer();
    if (!player) return;
    const next = Math.max(0, player.currentTime + seconds);
    player.currentTime = next;
    announce(COPY.seekAnnounce(positionModel.formatTime(next)));
  }

  function stepSpeed() {
    const player = activePlayer();
    const choices = settingsModel.SPEED_CHOICES;
    const current = player ? player.playbackRate : state.settings.defaultSpeed;
    let at = choices.indexOf(current);
    if (at < 0) at = choices.indexOf(1);
    at = (at + 1) % choices.length;
    const next = choices[at];
    if (player) player.playbackRate = next;
    els["btn-speed"].textContent = formatSpeed(next);
    announce(COPY.speedAnnounce(next));
  }

  function seek() {
    const player = activePlayer();
    if (!player) return;
    const ratio = Number(els["player-seek"].value) / 100;
    if (!Number.isFinite(player.duration) || player.duration <= 0) return;
    player.currentTime = ratio * player.duration;
  }

  function setVolume() {
    const value = Number(els["player-volume"].value);
    els["player-video"].volume = value;
    els["player-audio"].volume = value;
    els["player-volume-value"].textContent = Math.round(value * 100) + "%";
  }

  /* ------------------------------------------------------------------ *
   * The sleep timer.
   *
   * One interval, armed only while a timer is running, and a tick is a call
   * into the state machine. When the machine says the timer has fired, the
   * player is paused ONCE and the interval is disarmed. A second fire is
   * impossible because the state is terminal.
   * ------------------------------------------------------------------ */
  function startSleepTimer(minutes) {
    state.sleep = sleepModel.create(minutes, Date.now());
    if (!sleepModel.isRunning(state.sleep)) {
      stopSleepTimer();
      return;
    }
    stopSleepTimer();
    state.sleepTimerId = setInterval(function () {
      state.sleep = sleepModel.tick(state.sleep, Date.now());
      if (sleepModel.shouldPause(state.sleep, Date.now())) {
        const player = activePlayer();
        if (player && !player.paused) {
          player.pause();
          state.playing = false;
          renderPlayerState();
          savePositionNow();
        }
        announce("The sleep timer ran out, so playback is paused.");
        stopSleepTimer();
      }
      renderSleepRow();
    }, 1000);
    renderSleepRow();
    announce(COPY.sleepStarted(minutes));
  }

  function stopSleepTimer() {
    if (state.sleepTimerId) {
      clearInterval(state.sleepTimerId);
      state.sleepTimerId = 0;
    }
    state.sleep = sleepModel.off();
    renderSleepRow();
  }

  function renderSleepRow() {
    const running = sleepModel.isRunning(state.sleep);
    const box = els["player-sleep"];
    box.hidden = !running && !sleepModel.hasFired(state.sleep);
    if (!box.hidden) {
      els["player-sleep-text"].textContent = sleepModel.describe(state.sleep, Date.now());
    }
  }

  /* ------------------------------------------------------------------ *
   * Position saving.
   *
   * Armed only while playing: a paused player writes once, on the pause
   * event, and nothing is written again until the next play.
   * ------------------------------------------------------------------ */
  function armPositionSaving() {
    if (state.positionTimerId) return;
    state.positionTimerId = setInterval(savePositionNow, 5000);
  }

  function savePositionNow() {
    const row = currentRow();
    const player = activePlayer();
    if (!row || !player || row.kind === "page") return;
    if (!Number.isFinite(player.duration) || player.duration <= 0) return;
    void message("playlist.position", { id: row.id, position: player.currentTime })
      .then(function (reply) {
        if (reply && reply.ok === true) {
          state.rows = state.rows.map(function (entry) {
            if (entry.id !== row.id) return entry;
            return Object.assign({}, entry, {
              position: reply.position,
              finished: reply.finished,
            });
          });
          renderList();
        }
      })
      .catch(function () { /* a position that cannot be saved is retried on the next pause */ });
  }

  /* ------------------------------------------------------------------ *
   * Reorder: keyboard and drag, both through the same move
   * ------------------------------------------------------------------ */
  function moveSelected(delta) {
    const from = state.index >= 0 ? state.index : selectedIndexFromFocus();
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= state.rows.length) return;
    const row = state.rows[from];
    void message("playlist.move", { from: from, to: to })
      .then(function (reply) {
        if (reply && reply.ok === true) {
          state.rows = reply.queue;
          state.index = to;
          renderList();
          announce(COPY.moved(row.title || "Item", delta < 0 ? "up" : "down"));
        }
      })
      .catch(function () { showError("That move could not be saved."); });
  }

  function selectedIndexFromFocus() {
    const active = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest(".queue__row")
      : null;
    if (!active) return -1;
    return Number(active.dataset.index || -1);
  }

  /* ------------------------------------------------------------------ *
   * Drag and drop
   * ------------------------------------------------------------------ */
  let dragIndex = -1;

  function onDragStart(event) {
    const row = event.currentTarget;
    dragIndex = Number(row.dataset.index || -1);
    row.classList.add("queue__row--dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(dragIndex));
    }
  }

  function onDragOver(event) {
    if (dragIndex < 0) return;
    event.preventDefault();
    const row = event.currentTarget;
    row.classList.add("queue__row--over");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event) {
    event.preventDefault();
    const row = event.currentTarget;
    const to = Number(row.dataset.index || -1);
    if (dragIndex < 0 || to < 0 || dragIndex === to) return;
    const moved = state.rows[dragIndex];
    void message("playlist.move", { from: dragIndex, to: to })
      .then(function (reply) {
        if (reply && reply.ok === true) {
          state.rows = reply.queue;
          state.index = to;
          renderList();
          announce(COPY.moved(moved.title || "Item", to < dragIndex ? "up" : "down"));
        }
      })
      .catch(function () { showError("That move could not be saved."); });
  }

  function onDragEnd(event) {
    dragIndex = -1;
    for (const row of els["queue-list"].querySelectorAll(".queue__row")) {
      row.classList.remove("queue__row--dragging");
      row.classList.remove("queue__row--over");
    }
    void event;
  }

  /* ------------------------------------------------------------------ *
   * Full screen and PiP, with the honest unsupported path
   * ------------------------------------------------------------------ */
  function toggleFullscreen() {
    const player = activePlayer();
    const target = player || els["player-video"];
    if (!document.fullscreenElement) {
      if (target.requestFullscreen) {
        void target.requestFullscreen().catch(function () {
          showError("Full screen was refused for this item.");
        });
      }
    } else if (document.exitFullscreen) {
      void document.exitFullscreen();
    }
  }

  function togglePictureInPicture() {
    const player = els["player-video"];
    if (typeof player.requestPictureInPicture !== "function") {
      showError(COPY.pipUnsupported);
      return;
    }
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture();
      return;
    }
    void player.requestPictureInPicture().then(function () {
      announce("Playing in a floating window.");
    }).catch(function () {
      showError(COPY.pipUnsupported);
    });
  }

  /* ------------------------------------------------------------------ *
   * Row actions
   * ------------------------------------------------------------------ */
  function onQueueClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const row = button.closest(".queue__row");
    const index = Number(row.dataset.index || -1);
    const id = row.dataset.id;
    const action = button.dataset.action;
    if (action === "play") {
      selectRow(index);
    } else if (action === "up") {
      moveSelected(-1);
    } else if (action === "down") {
      moveSelected(1);
    } else if (action === "remove") {
      void message("playlist.remove", { id: id }).then(function (reply) {
        if (reply && reply.ok === true) {
          const removed = state.rows[index];
          state.rows = reply.queue;
          if (state.index === index) {
            state.index = -1;
            stopSleepTimer();
          } else if (state.index > index) {
            state.index -= 1;
          }
          renderList();
          renderPlayerState();
          announce(COPY.removed + (removed && removed.title ? " " + removed.title : ""));
        }
      }).catch(function () { showError("That item could not be removed."); });
    }
  }

  function onQueueKeyDown(event) {
    const row = event.target.closest && event.target.closest(".queue__row");
    const index = row ? Number(row.dataset.index || -1) : -1;
    const id = row ? row.dataset.id : null;
    if (event.key === "ArrowUp" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      state.index = index;
      moveSelected(-1);
    } else if (event.key === "ArrowDown" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      state.index = index;
      moveSelected(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = index + (event.key === "ArrowUp" ? -1 : 1);
      if (next >= 0 && next < state.rows.length) {
        state.index = next;
        renderList();
        const target = els["queue-list"].querySelector('.queue__row[data-index="' + next + '"] .queue__play');
        if (target) target.focus();
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectRow(index >= 0 ? index : 0);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (index >= 0) {
        void message("playlist.remove", { id: id }).then(function (reply) {
          if (reply && reply.ok === true) {
            state.rows = reply.queue;
            renderList();
            announce(COPY.removed);
          }
        });
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      skip(-15);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      skip(15);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      stepSpeed();
    } else if (event.key === "-") {
      event.preventDefault();
      const player = activePlayer();
      const choices = settingsModel.SPEED_CHOICES;
      if (player) {
        let at = choices.indexOf(player.playbackRate);
        if (at < 0) at = choices.indexOf(1);
        at = at <= 0 ? choices.length - 1 : at - 1;
        player.playbackRate = choices[at];
        els["btn-speed"].textContent = formatSpeed(choices[at]);
        announce(COPY.speedAnnounce(choices[at]));
      }
    } else if (event.key === "s") {
      event.preventDefault();
      startSleepTimer(state.settings.sleepTimerMinutes || 15);
    } else if (event.key === "f") {
      event.preventDefault();
      toggleFullscreen();
    } else if (event.key === "p") {
      event.preventDefault();
      togglePictureInPicture();
    }
  }

  /* ------------------------------------------------------------------ *
   * Media element events
   * ------------------------------------------------------------------ */
  function bindPlayerEvents() {
    for (const player of [els["player-video"], els["player-audio"]]) {
      player.addEventListener("timeupdate", function () {
        if (state.dragging) return;
        els["player-elapsed"].textContent = positionModel.formatTime(player.currentTime);
        if (Number.isFinite(player.duration) && player.duration > 0) {
          els["player-duration"].textContent = positionModel.formatTime(player.duration);
          const ratio = (player.currentTime / player.duration) * 100;
          if (!state.dragging) els["player-seek"].value = String(ratio);
        }
      });
      player.addEventListener("durationchange", function () {
        const row = currentRow();
        if (row && Number.isFinite(player.duration) && player.duration > 0) {
          void message("playlist.duration", { id: row.id, duration: player.duration });
        }
        els["player-duration"].textContent = Number.isFinite(player.duration)
          ? positionModel.formatTime(player.duration)
          : "0:00";
      });
      player.addEventListener("play", function () {
        state.playing = true;
        renderPlayerState();
        armPositionSaving();
      });
      player.addEventListener("pause", function () {
        state.playing = false;
        renderPlayerState();
        savePositionNow();
        if (state.positionTimerId) {
          clearInterval(state.positionTimerId);
          state.positionTimerId = 0;
        }
      });
      player.addEventListener("ended", function () {
        state.playing = false;
        savePositionNow();
        if (state.positionTimerId) {
          clearInterval(state.positionTimerId);
          state.positionTimerId = 0;
        }
        renderPlayerState();
      });
      player.addEventListener("error", function () {
        state.playing = false;
        renderPlayerState();
        showError(COPY.notPlayable);
      });
      player.addEventListener("enterpictureinpicture", function () {
        announce("Playing in a floating window.");
      });
    }

    els["player-seek"].addEventListener("input", function () {
      state.dragging = true;
    });
    els["player-seek"].addEventListener("change", function () {
      state.dragging = false;
      seek();
    });
    els["player-volume"].addEventListener("input", setVolume);
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */
  function bind() {
    els["btn-play"].addEventListener("click", togglePlay);
    els["btn-back15"].addEventListener("click", function () { skip(-15); });
    els["btn-forward15"].addEventListener("click", function () { skip(15); });
    els["btn-speed"].addEventListener("click", stepSpeed);
    els["btn-sleep"].addEventListener("click", function () {
      const minutes = state.settings.sleepTimerMinutes || 15;
      if (sleepModel.isRunning(state.sleep)) stopSleepTimer();
      else startSleepTimer(minutes);
    });
    els["btn-sleep-cancel"].addEventListener("click", function () {
      stopSleepTimer();
      announce(COPY.sleepCancelled);
    });
    els["btn-pip"].addEventListener("click", togglePictureInPicture);
    els["btn-fullscreen"].addEventListener("click", toggleFullscreen);
    els["btn-clear"].addEventListener("click", clearQueue);
    els["btn-reset"].addEventListener("click", clearQueue);

    els["queue-list"].addEventListener("click", onQueueClick);
    els["queue-list"].addEventListener("keydown", onQueueKeyDown);

    els["btn-settings"].addEventListener("click", function () {
      toggleSection("settings-body", "btn-settings");
    });
    els["btn-help"].addEventListener("click", function () {
      toggleSection("help-body", "btn-help");
    });

    const persist = function () {
      const next = settingsModel.patch(state.settings, {
        defaultSpeed: Number(els["setting-speed"].value) || 1,
        sleepTimerMinutes: Number(els["setting-sleep"].value) || 0,
        resumeMode: els["setting-resume"].value,
        panelSide: els["setting-side"].value,
        autoAddPrompt: els["setting-prompt"].value === "on",
        mediaQuality: els["setting-quality"].value,
      });
      state.settings = next;
      void message("playlist.settings.set", { settings: next });
      announce("Playlist settings saved.");
    };
    for (const id of ["setting-speed", "setting-sleep", "setting-resume", "setting-side",
                      "setting-prompt", "setting-quality"]) {
      els[id].addEventListener("change", persist);
    }

    /* The honest note. The reference's background playback is an OS-level
       feature: its player lives in a browser-side process that outlives the
       UI. On Gecko an extension has no such process, so the panel IS the
       player, and that is stated where the user is rather than buried in a
       doc. The setting that claims to choose a mode would be a lie, so it is
       not offered. */
    setNote(COPY.backgroundNote);
  }

  function toggleSection(id, buttonId) {
    const section = els[id];
    const button = els[buttonId];
    const open = section.hidden;
    section.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  function clearQueue() {
    void message("playlist.clear").then(function (reply) {
      if (reply && reply.ok === true) {
        state.rows = [];
        state.index = -1;
        stopSleepTimer();
        renderList();
        renderPlayerState();
        announce(COPY.cleared);
      }
    }).catch(function () { showError("The queue could not be cleared."); });
  }

  /* The panel closing is not an event we get, but the page being hidden
     while playing is: that is where the reference's "keeps playing" promise
     would have to live, and this engine does not offer it. The position is
     written here so nothing is lost in the meantime. */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") savePositionNow();
  });

  ready(function () {
    bind();
    bindPlayerEvents();
    setVolume();
    load();
  });
})();
