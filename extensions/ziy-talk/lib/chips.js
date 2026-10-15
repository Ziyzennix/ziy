/* Ziy Talk — the control-chip state machine.
 *
 * The in-call control bar (replica/design/components.md §20, recon S39) is a
 * product-owned surface sitting above or beside the meeting. Its whole job is
 * to be honest about what it can do:
 *
 *   - when the server's External API is present, each chip drives a real
 *     Jitsi command (`api.executeCommand('toggleAudio')` and its siblings) and
 *     the chip state tracks the events Jitsi emits back.
 *   - when it is not (a server without the iframe API, or a server that failed
 *     to load), the chips degrade to LINKS and ANNOTATIONS. They do not fake a
 *     toggle, they do not pretend a button worked, and the meeting iframe still
 *     works for everything the iframe itself offers.
 *
 * The state machine is pure: it maps (chip id, current chip state) to an
 * intent, and separately maps a Jitsi event to a chip-state transition. Both
 * directions are exercised in the tests, including the degraded mode. No DOM,
 * no `browser.*`, no network — UMD export like the rest of lib/.
 *
 * The Jitsi command names are not invented here. They are the documented
 * commands of JitsiMeetExternalAPI.executeCommand(), verified on 2026-10-14:
 *   https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe-functions
 *   https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe-commands
 *   https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe-events
 * The event names in MAP_EVENT_TO_CHIP below are the public ones the same
 * page lists (audioMuteStatusChanged, videoMuteStatusChanged,
 * screenSharingStatusChanged, raiseHandUpdated, participantJoined /
 * participantLeft, videoConferenceJoined, videoConferenceLeft, readyToClose,
 * errorOccurred, videoAvailabilityChanged, audioAvailabilityChanged).
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ZiyTalkChips = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * The chip roster.
   *
   * The seven controls recon S39 names, plus the two navigational ones the
   * panel needs (leave, advanced). Order here is the order on screen.
   *
   * kind:
   *   toggle  a two-state control: off/down or on/active
   *   pane    opens something Jitsi draws (chat, participants)
   *   action  a one-shot with no persistent state
   * ------------------------------------------------------------------ */
  const CHIPS = Object.freeze([
    Object.freeze({ id: "microphone", kind: "toggle", jitsi: "toggleAudio" }),
    Object.freeze({ id: "camera", kind: "toggle", jitsi: "toggleVideo" }),
    Object.freeze({ id: "screen", kind: "toggle", jitsi: "toggleShareScreen" }),
    Object.freeze({ id: "chat", kind: "pane", jitsi: "toggleChat" }),
    Object.freeze({ id: "hand", kind: "toggle", jitsi: "toggleRaiseHand" }),
    Object.freeze({ id: "participants", kind: "pane", jitsi: "toggleParticipantsPane" }),
    Object.freeze({ id: "tiles", kind: "toggle", jitsi: "toggleTileView" }),
    Object.freeze({ id: "advanced", kind: "action", jitsi: null }),
    Object.freeze({ id: "leave", kind: "action", jitsi: "hangup" }),
  ]);

  const CHIP_IDS = CHIPS.map((c) => c.id);

  /* ------------------------------------------------------------------ *
   * Labels, Ziy-voiced, with the state in the name.
   *
   * The design system is explicit that the state is never colour-only and is
   * never carried by the label alone, so each chip gets a name for its off state
   * and its on state and the aria-label is rebuilt from whichever applies.
   * ------------------------------------------------------------------ */
  const LABELS = Object.freeze({
    microphone: { off: "Microphone", on: "Microphone, muted", onGlyph: "mic-off" },
    camera: { off: "Camera", on: "Camera, off", onGlyph: "camera-off" },
    screen: { off: "Share your screen", on: "Stop sharing your screen", onGlyph: "screen-on" },
    chat: { off: "Chat", on: "Chat, showing", onGlyph: "chat-on" },
    hand: { off: "Raise your hand", on: "Lower your hand", onGlyph: "hand-on" },
    participants: { off: "People", on: "People, showing", onGlyph: "people-on" },
    tiles: { off: "Tile view", on: "Grid view", onGlyph: "tiles-on" },
    advanced: { off: "More call actions", on: "More call actions" },
    leave: { off: "Leave the call", on: "Leave the call" },
  });

  /** Chip count text. "People, showing, 3 here" etc. */
  const CHIP_GLYPH = Object.freeze({
    microphone: "mic",
    camera: "camera",
    screen: "screen",
    chat: "chat",
    hand: "hand",
    participants: "people",
    tiles: "tiles",
    advanced: "more",
    leave: "leave",
  });

  /* ------------------------------------------------------------------ *
   * `bridge` records whether the Jitsi External API is present and loaded, and it
   * is the single thing that decides whether a chip press does anything. Not
   * frozen: callers legitimately build a derived state with Object.assign, and a
   * frozen factory would make that throw rather than being a useful guard.
   */
  function factoryChipState() {
    return {
      microphone: false,
      camera: false,
      screen: false,
      chat: false,
      hand: false,
      tiles: false,
      advanced: false,
      participantsPane: false,
      bridge: 'absent',
      call: 'idle',
      participants: 0,
      error: null,
      deviceUnavailable: { audio: false, video: false },
    };
  }

  /* ------------------------------------------------------------------ *
   * The intents a chip press produces.
   *
   * Three options, and the machine chooses between them rather than the caller:
   *
   *   command   the bridge is live; run this Jitsi command
   *   degraded  the bridge is absent; this is what the chip does instead
   *   rejected  nothing to press yet (no call in progress)
   * ------------------------------------------------------------------ */
  const DEGRADED_FALLBACK = Object.freeze({
    microphone: { kind: "annotate", text: "Your browser mutes here — the meeting controls it too" },
    camera: { kind: "annotate", text: "Your browser turns the camera off here — the meeting controls it too" },
    screen: { kind: "link", text: "Share your screen from the meeting's own toolbar", },
    chat: { kind: "link", text: "Chat lives in the meeting window", },
    hand: { kind: "annotate", text: "Raise your hand from the meeting window", },
    participants: { kind: "annotate", text: "The participant list is inside the meeting window" },
    tiles: { kind: "link", text: "Layout is chosen inside the meeting window", },
    advanced: { kind: "link", text: "Everything is in the meeting window" },
    leave: { kind: "link", text: "Close the meeting to leave" },
  });

  /**
   * What should happen when a chip is pressed.
   * @param {string} id chip id
   * @param {object} state the chip state
   * @returns {{kind: 'command'|'degraded'|'rejected', command?: string, fallback?: object, text?: string}}
   */
  function press(id, state) {
    const chip = CHIPS.find((c) => c.id === id);
    if (!chip) return { kind: "rejected", text: `There is no ${id} control.` };
    if (state.call !== "live" && id !== "leave") {
      return {
        kind: "rejected",
        text: "There is no call in progress yet, so this would do nothing.",
      };
    }
    if (state.bridge === "live" && chip.jitsi) {
      return { kind: "command", command: chip.jitsi };
    }
    return { kind: "degraded", fallback: DEGRADED_FALLBACK[id] };
  }

  /* ------------------------------------------------------------------ *
   * The reverse direction: Jitsi events -> chip state.
   *
   * Only the chips that Jitsi actually reports are transitions; everything else
   * is a call-lifecycle change (joined, left, fatal error) or no change at all.
   * Unknown events return the state unchanged, which is what keeps the
   * machine honest when a server emits something this build has never seen.
   * ------------------------------------------------------------------ */
  const MAP_EVENT_TO_CHIP = Object.freeze({
    audioMuteStatusChanged: { chip: "microphone", from: "muted" },
    videoMuteStatusChanged: { chip: "camera", from: "muted" },
    screenSharingStatusChanged: { chip: "screen", from: "visible" },
    raiseHandUpdated: { chip: "hand", from: "visible" },
  });

  const EVENT_LIFECYCLE = Object.freeze({
    videoConferenceJoined: "live",
    videoConferenceLeft: "ended",
    readyToClose: "ended",
    hangup: "ended",
  });

  /**
   * Applies one Jitsi event to the chip state. Pure: returns a new state.
   * @param {object} state
   * @param {string} eventName the Jitsi public event name
   * @param {object} [payload] the event payload
   */
  function applyEvent(state, eventName, payload) {
    const next = Object.assign({}, state);

    if (eventName === "ready" || eventName === "readyToClose") {
      next.bridge = state.bridge === "live" ? "live" : "loading";
    }

    const lifecycle = EVENT_LIFECYCLE[eventName];
    if (lifecycle) next.call = lifecycle;

    if (eventName === "videoConferenceJoined") next.bridge = "live";

    if (eventName === "errorOccurred") {
      const fatal = payload && payload.isFatal;
      if (fatal) {
        next.call = "error";
        next.error = (payload && payload.message) || "The meeting dropped the connection.";
      }
    }

    if (eventName === 'audioAvailabilityChanged') {
      // A device that disappears is shown as muted on the chip, because a live
      // toggle for hardware that is gone is a lie. A device that comes back is
      // NOT forced to "live" — the user may still be deliberately muted — so the
      // device-unavailable flag is cleared by remembering it separately.
      if (payload && payload.available === false) {
        next.microphone = true;
        next.deviceUnavailable = Object.assign({}, state.deviceUnavailable, { audio: true });
      } else if (next.deviceUnavailable && next.deviceUnavailable.audio) {
        // The device is back and the mute state was only ever the absence of a
        // device, so it clears.
        next.microphone = false;
        next.deviceUnavailable = Object.assign({}, next.deviceUnavailable, { audio: false });
      }
    }
    if (eventName === 'videoAvailabilityChanged') {
      if (payload && payload.available === false) {
        next.camera = true;
        next.deviceUnavailable = Object.assign({}, state.deviceUnavailable, { video: true });
      } else if (next.deviceUnavailable && next.deviceUnavailable.video) {
        next.camera = false;
        next.deviceUnavailable = Object.assign({}, next.deviceUnavailable, { video: false });
      }
    }

    if (eventName === "participantJoined") next.participants = state.participants + 1;
    if (eventName === "participantLeft") {
      next.participants = Math.max(0, state.participants - 1);
    }

    const mapping = MAP_EVENT_TO_CHIP[eventName];
    if (mapping) {
      // Jitsi reports the NEGATED value for the toggles: `muted: true` means the
      // microphone is muted, so the chip's "on" state is the value Jitsi gives.
      // For the raises/shares it reports the negated one too: the screen chip
      // is on when Jitsi says a screen is visible.
      const value = payload ? payload[mapping.from] : undefined;
      if (typeof value === "boolean") next[mapping.chip] = value;
    }

    return next;
  }

  /* ------------------------------------------------------------------ *
   * The accessible-name builder.
   * ------------------------------------------------------------------ */
  function label(id, state) {
    const base = LABELS[id];
    if (!base) return id;
    const on = Boolean(state[id]);
    return on ? base.on : base.off;
  }

  function glyph(id) {
    return CHIP_GLYPH[id] || "more";
  }

  /** aria-pressed for a toggle chip; null for chips that are not toggles. */
  function pressed(id, state) {
    const chip = CHIPS.find((c) => c.id === id);
    if (!chip) return null;
    if (chip.kind === "toggle") return Boolean(state[id]);
    if (chip.kind === "pane") return Boolean(state[id]);
    return null;
  }

  /**
   * The line a screen reader hears when the call state changes: the participants
   * live region the design system asks for.
   */
  function participantsAnnouncement(state) {
    if (state.call === "live" && state.participants === 0) {
      return "You are the only one here so far.";
    }
    if (state.call === "live" && state.participants === 1) {
      return "1 other person is here.";
    }
    if (state.call === "live" && state.participants > 1) {
      return `${state.participants} other people are here.`;
    }
    return "";
  }

  return {
    CHIPS,
    CHIP_IDS,
    CHIP_GLYPH,
    LABELS,
    DEGRADED_FALLBACK,
    MAP_EVENT_TO_CHIP,
    EVENT_LIFECYCLE,
    factoryChipState,
    press,
    applyEvent,
    label,
    glyph,
    pressed,
    participantsAnnouncement,
  };
});
