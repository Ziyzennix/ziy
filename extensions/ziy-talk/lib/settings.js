/* Ziy Talk — the settings model.
 *
 * One definition of what a Ziy Talk configuration is: the shape, the defaults,
 * the merge semantics and the third-party gate. Used by the sidebar panel, the
 * options page, the background event page and the unit tests, so there is
 * exactly one place where a Talk setting is defined.
 *
 * No DOM, no `browser.*` access, no I/O: pure, so the same code runs in a page
 * and under `node --test`. UMD-style export, like lib/room.js.
 *
 * THE BACKEND IS A HANDOFF, AND THAT IS A PRODUCT DECISION
 * -----------------------------------------------------
 * Brave Talk is a hosted service: the browser side is only an entry URL, a
 * sidebar item, a pref and a `braveTalk.isSupported()` that returns false in
 * Tor (replica/re-deep-core.md §6). Ziy does not run a call service. Ziy's
 * Talk surface is ours — the lobby, the room link, the control chips — and the
 * meeting itself is handed to a Jitsi Meet the user points us at.
 *
 * The only shipped default is therefore a first-party PLACEHOLDER:
 * `https://meet.example.invalid` is a reserved domain that can never resolve
 * (RFC 6761 reserves .invalid), so it names the shape of a self-hosted server
 * without implying anyone runs one. It is deliberately unreachable so the
 * default state states itself honestly: "no server configured yet".
 *
 * A public third-party server (meet.jit.si is the well-known one) is offered
 * as an explicitly-labelled PUBLIC TEST SERVER with a warning gate, because a
 * call on someone else's server hands them the call metadata, the IP address
 * and any room name not covered by an authenticated JWT. That is a real trust
 * tradeoff, so it is named as one and it is opt-in only.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ZiyTalkSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Storage keys (architecture.md §3.1).
   *
   *   talk.room    TalkRoom — the transient per-call record
   *   talk.settings  the settings bus row for this module
   *   talk.recent  TalkRoom[] — the recent-rooms list
   * ------------------------------------------------------------------ */
  const KEY_SETTINGS = "talk.settings";
  const KEY_RECENT = "talk.recent";
  const KEY_ROOM = "talk.room";

  /* The shipped default server. RFC 6761 reserves `.invalid` to be
     permanently unresolvable, so this is a well-formed https origin that no
     DNS server can ever answer: the shape of a self-hosted Jitsi without
     pretending one exists. */
  const DEFAULT_SERVER = "https://meet.example.invalid";

  /* The public test server. Offered as a labelled option, never a default.
     It is Jitsi's own free community deployment — someone else's server
     running someone else's logging, hence the gate. */
  const PUBLIC_TEST_SERVER = "https://meet.jit.si";
  const PUBLIC_TEST_SERVER_LABEL = "Public test server (meet.jit.si)";

  const KNOWN_PUBLIC_SERVERS = Object.freeze([PUBLIC_TEST_SERVER]);

  /* Every setting the model owns, with its factory value and its validator.
     A validator returns null for "fine", or a message a person can act on. */
  const FIELDS = Object.freeze([
    {
      key: "serverUrl",
      default: DEFAULT_SERVER,
      validate: validateServerUrl,
      hint: "The Jitsi Meet server your calls run on, with the scheme: https://meet.example.org",
    },
    {
      key: "displayName",
      default: "",
      // The whole field's rule is "a string of at most 200 characters", not just
      // the length: a stored number would otherwise survive normalisation and be
      // written into the meeting's config verbatim.
      validate: (v) => {
        if (typeof v !== "string") return "Your name must be text, not a number.";
        if (v.length > 200) return "Keep your name under 200 characters.";
        return null;
      },
      hint: "How you appear to the other people in the call. Blank is allowed.",
    },
    {
      key: "audioMuted",
      default: false,
      validate: (v) => (typeof v === "boolean" ? null : "Must be yes or no."),
      hint: "Join with your microphone already muted.",
    },
    {
      key: "videoMuted",
      default: true,
      validate: (v) => (typeof v === "boolean" ? null : "Must be yes or no."),
      hint: "Join with your camera off. Off by default: a call should not switch your camera on until you say so.",
    },
    {
      key: "cameraPreview",
      default: true,
      validate: (v) => (typeof v === "boolean" ? null : "Must be yes or no."),
      hint: "Ask for camera permission in the lobby so you can check your framing before joining.",
    },
    {
      key: "openInNewTab",
      default: false,
      validate: (v) => (typeof v === "boolean" ? null : "Must be yes or no."),
      hint: "Open calls in a tab instead of this panel, for a full-size window.",
    },
    {
      key: "warnThirdParty",
      default: true,
      validate: (v) => (typeof v === "boolean" ? null : "Must be yes or no."),
      hint: "Warn before every call on a server Ziy does not run.",
    },
    {
      key: "preMeetingScreen",
      default: true,
      validate: (v) => (typeof v === "boolean" ? null : "Must be yes or no."),
      hint: "Stop at the lobby to check your name and devices instead of joining straight into the call.",
    },
    {
      key: "sounds",
      default: true,
      validate: (v) => (typeof v === "boolean" ? null : "Must be yes or no."),
      hint: "Play a short tone when someone joins or leaves.",
    },
  ]);

  function factorySettings() {
    const out = {};
    for (const f of FIELDS) out[f.key] = f.default;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Server URL handling.
   * ------------------------------------------------------------------ */

  /**
   * Whether a host is on the public test-server list. Compared on the exact
   * https origin, because `meet.jit.si.evil.example` is not meet.jit.si and a
   * suffix match would say otherwise.
   */
  function isPublicTestServer(value) {
    return normaliseServerUrl(value) === PUBLIC_TEST_SERVER;
  }

  /**
   * A server URL normalised to its origin: scheme, host, port and nothing else.
   * A path on the origin is meaningless here — a Jitsi room lives at
   * `<origin>/<room>` — and keeping it out of the comparison is what stops
   * `https://server/one` and `https://server/two` from being two servers.
   * @returns {string|null} the https origin, or null when it does not parse.
   */
  function normaliseServerUrl(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed === "") return null;
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    // https only, for two reasons: a call sends audio, video and metadata, and
    // an http origin would make all three visible on the wire; and the public
    // test server is https, so http would silently mean a different host.
    if (url.protocol !== "https:") return null;
    // Credentials in a URL are not a supported way to point at a server.
    if (url.username !== "" || url.password !== "") return null;
    return url.origin;
  }

  /**
   * The validator for the server field: null when fine, a message otherwise.
   */
  function validateServerUrl(value) {
    if (typeof value !== "string" || value.trim() === "") {
      return "Enter the address of your Jitsi Meet server.";
    }
    if (normaliseServerUrl(value) === null) {
      return "That is not a usable https server address. Include the scheme, for example https://meet.example.org";
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Normalisation.
   *
   * Anything not stored is the default; anything stored but wrong-shaped is
   * replaced by the default rather than half-accepted. A settings record that
   * survives a schema change must therefore still be a valid record.
   * ------------------------------------------------------------------ */
  function normaliseSettings(stored) {
    const out = factorySettings();
    if (!stored || typeof stored !== "object") return out;
    for (const f of FIELDS) {
      const value = stored[f.key];
      if (value === undefined) continue;
      // A stored value must satisfy its own field's validator; if it does not,
      // the default stands. This is what makes an old record self-healing.
      const error = f.validate(value);
      if (error === null) out[f.key] = value;
    }
    return out;
  }

  /** The persisted record is exactly the normalised record. */
  function serialiseSettings(settings) {
    return normaliseSettings(settings);
  }

  /* ------------------------------------------------------------------ *
   * The third-party gate — the honest part of this module.
   *
   * The gate asks one question, and the answer is a decision rather than a
   * boolean: can this call start, or must the user be told what it costs first?
   *
   *   own / unconfigured server  -> allow, no gate. There is nobody to warn
   *                                about. The default `.invalid` origin is in
   *                                this class: it names a server the user must
   *                                supply, and it cannot reach anyone.
   *   public test server + gate on  -> confirm. The call can still happen; the
   *                                user has to see who runs it first.
   *   public test server + gate off -> allow, permanently. Turning the gate
   *                                off is exactly this decision, and re-asking
   *                                every time would train the user to dismiss.
   *   gate off, any server       -> allow.
   * ------------------------------------------------------------------ */
  /**
   * What the server at `value` (or, when that is not given or not usable, the
   * configured one) actually is.
   *
   * `configured` means "there is a real https origin to call", and it is false
   * for the shipped reserved-invalid default as well as for junk: a URL that
   * cannot parse is not a server, so reporting it as configured would make the
   * panel try to start a call that can never open.
   */
  function serverTrust(settings, value) {
    const configured = normaliseServerUrl(value);
    const fallback = configured === null ? normaliseServerUrl(settings.serverUrl) : configured;
    // The default origin never counts as configured: .invalid cannot resolve, so
    // "configured" would be a lie that hides the real first-run state.
    const isConfigured = fallback !== null && fallback !== DEFAULT_SERVER;
    const isPublic = fallback !== null && KNOWN_PUBLIC_SERVERS.includes(fallback);
    return {
      origin: fallback,
      configured: isConfigured,
      isPublic,
      isSelfHosted: isConfigured && !isPublic,
      /** Whether the call must stop for the warning dialog before it starts. */
      requiresConfirmation: Boolean(settings.warnThirdParty) && isPublic,
    };
  }

  /* ------------------------------------------------------------------ *
   * Room links.
   *
   * A room link has to work across devices, so it must not be an extension
   * page or a moz-extension:// URL: those only open on this browser install.
   * The link therefore names the server and the room in the form any Jitsi
   * install understands.
   *
   * `ziy-talk://<room>` is Ziy's own scheme for the moments when Ziy IS
   * present (a link shared from Ziy to Ziy). It resolves to the configured
   * server's room URL, so it is a stable name for the room rather than a
   * second location for it.
   * ------------------------------------------------------------------ */
  function buildRoomUrl(server, roomId) {
    const origin = normaliseServerUrl(server);
    if (origin === null) return null;
    return `${origin}/${roomId}`;
  }

  function buildSchemeUrl(roomId) {
    if (typeof roomId !== "string" || roomId === "") return null;
    return `ziy-talk://${roomId}`;
  }

  /**
   * Resolves a `ziy-talk://<room>` URL against the configured server.
   * @param {string} href
   * @returns {{roomId: string|null, error: string|null}}
   */
  function resolveSchemeUrl(href, settings) {
    if (typeof href !== "string") return { roomId: null, error: "Not a link." };
    const match = /^ziy-talk:\/\/([^/?#]+)/.exec(href.trim());
    if (!match) return { roomId: null, error: "Not a Ziy Talk link." };
    let candidate;
    try {
      candidate = decodeURIComponent(match[1]);
    } catch {
      return { roomId: null, error: "That link's room code is not readable as written." };
    }
    requireRoomHelpers();
    if (!isValidRoomId(candidate)) {
      return { roomId: null, error: roomIdError(candidate) };
    }
    const server = normaliseServerUrl(settings && settings.serverUrl);
    // The shipped default is reserved-invalid: it parses, but nothing can reach
    // it. A scheme link must therefore be refused with a reason rather than
    // turned into a URL that can never load.
    if (server === null || server === DEFAULT_SERVER) {
      return {
        roomId: candidate,
        error: "Ziy's Talk server is not configured, so this room link cannot be opened yet.",
      };
    }
    return { roomId: candidate, error: null };
  }

  // Late-bound from lib/room.js. Both background and the extension pages load the
  // two libs together, so this is wired in by a call rather than an import (the
  // libs are UMD scripts sharing one global scope). If a caller reaches the
  // scheme resolver without binding, it throws instead of answering: a validator
  // that silently accepts everything is the failure mode this guards against.
  let roomIdError = null;
  let isValidRoomId = null;
  function bindRoomHelpers(helpers) {
    if (helpers && typeof helpers.roomIdError === "function") {
      roomIdError = helpers.roomIdError;
    }
    if (helpers && typeof helpers.isValidRoomId === "function") {
      isValidRoomId = helpers.isValidRoomId;
    }
  }
  function requireRoomHelpers() {
    if (typeof isValidRoomId !== "function" || typeof roomIdError !== "function") {
      throw new Error(
        "Ziy Talk: lib/room.js is not bound. Call ZiyTalkSettings.bindRoomHelpers(" +
        "ZiyTalkRoom) before using the scheme resolver."
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * The recent-rooms list.
   *
   * Bounded, newest first, deduplicated by room id, and never growing past
   * RECENT_MAX — a local list that grows without limit is a slow bug.
   * ------------------------------------------------------------------ */
  const RECENT_MAX = 12;

  function normaliseRecent(stored) {
    if (!Array.isArray(stored)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of stored) {
      if (!entry || typeof entry !== "object") continue;
      const room = entry.room || entry.roomId;
      if (typeof room !== "string" || room === "") continue;
      if (seen.has(room)) continue;
      seen.add(room);
      out.push({
        room,
        server: typeof entry.server === "string" ? entry.server : null,
        startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : 0,
        lastUsedAt: Number.isFinite(entry.lastUsedAt) ? entry.lastUsedAt : 0,
      });
    }
    return out.slice(0, RECENT_MAX);
  }

  function rememberRoom(list, room, server, now) {
    const timestamp = Number.isFinite(now) ? now : Date.now();
    const entry = {
      room,
      server: normaliseServerUrl(server),
      startedAt: timestamp,
      lastUsedAt: timestamp,
    };
    // A room you return to keeps its original startedAt: "you first used this
    // room on…" is a fact, "you were last here on…" is a different fact.
    const previous = list.find((r) => r.room === room);
    if (previous) entry.startedAt = previous.startedAt;
    const rest = list.filter((r) => r.room !== room);
    return [entry, ...rest].slice(0, RECENT_MAX);
  }

  /* ------------------------------------------------------------------ *
   * The TalkRoom record (architecture §3.1: storage.local, `talk.room`).
   * ------------------------------------------------------------------ */
  function normaliseRoom(stored) {
    if (!stored || typeof stored !== "object") return null;
    const room = stored.room || stored.roomId;
    if (typeof room !== "string") return null;
    // The record's job is to describe a real room, so the id must pass the same
    // charset test the join box applies. A record holding a malformed id
    // describes nothing.
    requireRoomHelpers();
    if (!isValidRoomId(room)) return null;
    return {
      room,
      server: normaliseServerUrl(stored.server),
      startedAt: Number.isFinite(stored.startedAt) ? stored.startedAt : Date.now(),
      endedAt: Number.isFinite(stored.endedAt) ? stored.endedAt : null,
      state: typeof stored.state === "string" ? stored.state : "precall",
    };
  }

  return {
    KEY_SETTINGS,
    KEY_RECENT,
    KEY_ROOM,
    DEFAULT_SERVER,
    PUBLIC_TEST_SERVER,
    PUBLIC_TEST_SERVER_LABEL,
    KNOWN_PUBLIC_SERVERS,
    FIELDS,
    RECENT_MAX,
    factorySettings,
    normaliseSettings,
    serialiseSettings,
    normaliseServerUrl,
    isPublicTestServer,
    serverTrust,
    buildRoomUrl,
    buildSchemeUrl,
    resolveSchemeUrl,
    normaliseRecent,
    rememberRoom,
    normaliseRoom,
    validateServerUrl,
    bindRoomHelpers,
  };
});
