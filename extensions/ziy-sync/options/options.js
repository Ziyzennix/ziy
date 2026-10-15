/**
 * Ziy Sync options page (recon S27).
 *
 * This is a page in the extension, so it can import the same lib/ modules the
 * background does. It never touches key material itself: every message that
 * would involve the code, a key, or the network goes to the background script,
 * which forwards it to the native agent.
 *
 * The rotating word
 * -----------------
 * A chain code alone is only half of the key. The other half is a word Ziy
 * publishes for the current UTC day, so a leaked code stops working. The page
 * says which bucket it is using, and if it cannot fetch the word it says so
 * honestly instead of continuing with a guess.
 */

import { CATEGORIES } from "../lib/keyderivation.js";
import { validateMnemonic, rotatingWordBucket } from "../lib/bip39.js";

const els = {
  views: {
    start: document.getElementById("view-start"),
    code: document.getElementById("view-code"),
    join: document.getElementById("view-join"),
    chain: document.getElementById("view-chain"),
  },
  stateRegion: document.getElementById("state-region"),
  words: document.getElementById("code-words"),
  rotatingNote: document.getElementById("rotating-note"),
  agentStatus: document.getElementById("agent-status"),
  deviceList: document.getElementById("device-list"),
  categoryList: document.getElementById("category-list"),
  chainId: document.getElementById("chain-id"),
  deviceName: document.getElementById("device-name"),
  lastSync: document.getElementById("last-sync"),
  serverUrl: document.getElementById("server-url"),
  syncResult: document.getElementById("sync-result"),
  joinForm: document.getElementById("join-form"),
  joinWords: document.getElementById("join-words"),
  joinWordsError: document.getElementById("join-words-error"),
  joinChainId: document.getElementById("join-chain-id"),
  joinChainError: document.getElementById("join-chain-error"),
  joinDeviceName: document.getElementById("join-device-name"),
  dialog: document.getElementById("confirm-dialog"),
  confirmTitle: document.getElementById("confirm-title"),
  confirmBody: document.getElementById("confirm-body"),
  confirmAccept: document.getElementById("btn-confirm-accept"),
};

const CATEGORY_LABELS = {
  bookmarks: ["Bookmarks", "Your saved pages"],
  passwords: ["Passwords", "Saved logins"],
  autofill: ["Autofill", "Addresses and form data"],
  history: ["Browsing history", "Pages you have visited"],
  tabs: ["Open tabs", "Which tabs each device has open"],
  extensions: ["Extensions", "Which add-ons are enabled"],
  themes: ["Themes", "Your browser's appearance"],
  apps: ["Apps", "Installed apps and their settings"],
  settings: ["Settings", "Search engine, sidebar, and other preferences"],
};

function show(name) {
  for (const [key, element] of Object.entries(els.views)) {
    element.hidden = key !== name;
  }
}

function announce(text) {
  els.stateRegion.textContent = text;
}

function error(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

/* ------------------------------------------------------------------------- */
/* rendering                                                                  */
/* ------------------------------------------------------------------------- */

function renderCode(words, rotating) {
  els.words.replaceChildren(
    ...words.map((word, index) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = word;
      li.append(span);
      // The word's index is provided by the CSS counter, so this span keeps the
      // list item's accessible name to the word itself and the ordered list
      // gives the screen reader "1 of 24" semantics for free.
      li.dataset.index = String(index + 1);
      return li;
    }),
  );

  const bucket = rotating && rotating.rotating_word_bucket ? rotating.rotating_word_bucket : rotatingWordBucket();
  if (rotating && rotating.rotating_word_source === "offline-fallback") {
    els.rotatingNote.textContent =
      `Ziy could not reach the rotating-word list, so it used the locally configured word ` +
      `for ${bucket}. Both devices must use the same bucket; re-check when the network is back.`;
  } else {
    els.rotatingNote.textContent =
      `Today's rotating word is ${rotating ? rotating.rotating_word : "(unknown)"} ` +
      `(bucket ${bucket}). A device joining this chain needs the word for its own UTC day.`;
  }
  els.rotatingNote.setAttribute("role", "status");
}

function renderChain(state) {
  els.chainId.textContent = state.chainId || "—";
  els.deviceName.textContent = state.deviceName || "—";
  els.lastSync.textContent = state.lastSyncAt ? new Date(state.lastSyncAt * 1000).toLocaleString() : "never";
  els.serverUrl.textContent = state.serverUrl || "—";

  els.deviceList.replaceChildren(...renderDevices(state.devices || []));
}

function renderDevices(devices) {
  if (!devices.length) {
    const li = document.createElement("li");
    li.className = "text-muted";
    li.textContent = "No other devices yet. Join from another device with your chain code.";
    return [li];
  }
  return devices.map((device) => {
    const li = document.createElement("li");
    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "device-name";
    name.textContent = device.device_name || "Unnamed device";
    const meta = document.createElement("div");
    meta.className = "device-meta";
    meta.textContent = `${device.device_type || "desktop"}${device.last_seen ? ` · last seen ${new Date(device.last_seen * 1000).toLocaleDateString()}` : ""}`;
    left.append(name, meta);

    if (device.is_self) {
      const badge = document.createElement("span");
      badge.className = "device-self";
      badge.textContent = "This device";
      li.append(left, badge);
    } else {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${device.device_name || "this device"} from this chain`);
      remove.addEventListener("click", () => {
        confirmThen(
          "Remove this device?",
          `${device.device_name || "This device"} will stop being applied on this device. It stays in the chain for everyone else.`,
          async () => {
            await send("ziy-sync/remove-device", { device_id: device.device_id });
            await refresh();
          },
        );
      });
      li.append(left, remove);
    }
    return li;
  });
}

/**
 * The per-category toggles. Two real checkboxes per category, because a single
 * "sync this" checkbox cannot express "send but do not receive" — which is a
 * state the product has to support (recon S27's category toggle).
 */
function renderCategories(categories) {
  els.categoryList.replaceChildren(
    ...CATEGORIES.map((category) => {
      const [label, description] = CATEGORY_LABELS[category] || [category, ""];
      const gate = categories[category] || { send: true, receive: true };

      const row = document.createElement("div");
      row.className = "toggle-row";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", `${label} sync settings`);

      const text = document.createElement("div");
      const strong = document.createElement("div");
      strong.className = "label";
      strong.textContent = label;
      const desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = description;
      text.append(strong, desc);

      const pair = document.createElement("div");
      pair.className = "toggle-pair";
      const sendCheck = checkbox("Send", gate.send, async (checked) => {
        await send("ziy-sync/set-category", { category, patch: { send: checked } });
      });
      const receiveCheck = checkbox("Receive", gate.receive, async (checked) => {
        await send("ziy-sync/set-category", { category, patch: { receive: checked } });
      });
      pair.append(sendCheck, receiveCheck);

      row.append(text, pair);
      return row;
    }),
  );
}

function checkbox(label, checked, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => {
    onChange(input.checked).catch((problem) => announce(problem.message));
  });
  const span = document.createElement("span");
  span.textContent = label;
  wrapper.append(input, span);
  return wrapper;
}

/* ------------------------------------------------------------------------- */
/* messaging                                                                  */
/* ------------------------------------------------------------------------- */

function send(op, extra = {}) {
  return browser.runtime.sendMessage({ op, ...extra });
}

async function refresh() {
  const state = await send("ziy-sync/state");
  if (state.inChain) {
    show("chain");
    renderChain(state);
    const devices = await send("ziy-sync/devices").catch(() => ({ devices: [] }));
    renderDevices(devices.devices || []);
    renderCategories(state.categories);
  } else {
    show("start");
  }
  return state;
}

/* ------------------------------------------------------------------------- */
/* the flows                                                                  */
/* ------------------------------------------------------------------------- */

document.getElementById("btn-start").addEventListener("click", async () => {
  try {
    // Step 1: the agent generates the words and the rotating word.
    const generated = await send("ziy-sync/start-chain");
    renderCode(generated.words, generated);
    show("code");
    document.getElementById("btn-code-done").disabled = false;
    announce("A new chain code has been generated. It is shown once.");
  } catch (problem) {
    announce(problem.message);
  }
});

document.getElementById("btn-copy-code").addEventListener("click", async () => {
  const words = [...els.words.querySelectorAll("li")].map((li) => li.textContent.trim());
  const bucket = rotatingWordBucket();
  const rotating = els.rotatingNote.textContent.match(/word is ([a-z]+)/);
  const text = [
    "Ziy sync chain code",
    "",
    `Words: ${words.join(" ")}`,
    `Rotating word (${bucket}): ${rotating ? rotating[1] : "see the options page"}`,
    "",
    "Both are needed to join this chain.",
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("code-copied").hidden = false;
  } catch {
    // A clipboard refusal is not a failure of the flow: the words are on screen
    // and the user can copy them by hand.
    document.getElementById("code-copied").textContent = "The browser refused clipboard access — copy the words by hand.";
    document.getElementById("code-copied").hidden = false;
  }
});

document.getElementById("btn-code-done").addEventListener("click", async () => {
  try {
    const words = [...els.words.querySelectorAll("li")].map((li) => li.textContent.trim());
    const rotatingMatch = els.rotatingNote.textContent.match(/word is ([a-z]+)/);
    const result = await send("ziy-sync/create-chain", {
      words,
      rotating_word: rotatingMatch ? rotatingMatch[1] : undefined,
      deviceName: "Ziy desktop",
    });
    announce(`Chain created. This device is ${result.device_name}.`);
    await refresh();
  } catch (problem) {
    announce(problem.message);
  }
});

document.getElementById("btn-join-open").addEventListener("click", () => {
  show("join");
  els.joinWords.focus();
});

document.getElementById("btn-join-cancel").addEventListener("click", () => {
  show("start");
});

els.joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  error(els.joinWordsError, "");
  error(els.joinChainError, "");

  // Validate the code here, on this device, before anything is sent: a typo is
  // caught by the BIP-39 checksum and the user is told which one it was.
  let words;
  try {
    words = await validateMnemonic(els.joinWords.value);
  } catch (problem) {
    error(els.joinWordsError, problem.message);
    els.joinWords.focus();
    return;
  }
  const chainId = els.joinChainId.value.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(chainId)) {
    error(els.joinChainError, "The chain code is missing or malformed. It is the second half of the code the first device showed.");
    els.joinChainId.focus();
    return;
  }

  try {
    const result = await send("ziy-sync/join-chain", { words, chain_id: chainId, deviceName: els.joinDeviceName.value });
    announce(`Joined chain ${result.chain_id.slice(0, 8)}… as this device.`);
    await refresh();
  } catch (problem) {
    error(els.joinWordsError, problem.message);
  }
});

document.getElementById("btn-sync-now").addEventListener("click", async () => {
  els.syncResult.hidden = true;
  try {
    const result = await send("ziy-sync/sync-now");
    els.syncResult.textContent =
      `Sync complete: ${result.pushed?.length || 0} sent, ${result.pulled || 0} accepted` +
      (result.rejected?.length ? `, ${result.rejected.length} could not be read` : "");
    els.syncResult.hidden = false;
    await refresh();
  } catch (problem) {
    els.syncResult.textContent = problem.message;
    els.syncResult.hidden = false;
  }
});

document.getElementById("btn-leave").addEventListener("click", () => {
  confirmThen(
    "Leave this chain?",
    "Ziy will delete the server's copy of this chain's blobs for every device. This device will stop syncing. Your local bookmarks stay where they are.",
    async () => {
      await send("ziy-sync/leave-chain");
      announce("You have left the chain. The server's cache is deleted.");
      await refresh();
    },
  );
});

document.getElementById("btn-delete").addEventListener("click", () => {
  confirmThen(
    "Delete your sync data?",
    "This deletes the server's copy AND this device's keys. It cannot be undone, and no device will be able to read the chain again.",
    async () => {
      await send("ziy-sync/delete-account");
      announce("Your sync data has been deleted.");
      await refresh();
    },
  );
});

/** Ask, then act. The dialog is a real <dialog>, so focus is trapped and Esc works. */
function confirmThen(title, body, action) {
  els.confirmTitle.textContent = title;
  els.confirmBody.textContent = body;
  els.confirmAccept.onclick = async () => {
    els.dialog.close();
    try {
      await action();
    } catch (problem) {
      announce(problem.message);
    }
  };
  els.dialog.addEventListener("close", () => {}, { once: true });
  if (typeof els.dialog.showModal === "function") els.dialog.showModal();
  else els.dialog.setAttribute("open", "");
}

document.getElementById("btn-confirm-cancel").addEventListener("click", () => {
  els.dialog.close?.();
});

/* ------------------------------------------------------------------------- */
/* start                                                                      */
/* ------------------------------------------------------------------------- */

(async function start() {
  try {
    const capabilities = await send("ziy-sync/capabilities");
    const ed25519 = (capabilities.algorithms || []).find((a) => a.name === "Ed25519");
    els.agentStatus.textContent = ed25519 && ed25519.available ? "Sync agent ready" : "Sync agent unavailable";
    els.agentStatus.className = ed25519 && ed25519.available ? "pill pill-ok" : "pill pill-error";
  } catch {
    els.agentStatus.textContent = "Sync agent not running";
    els.agentStatus.className = "pill pill-error";
  }

  // Respect the user's colour scheme: the tokens file's dark values hang off
  // [data-theme="dark"], and 156 supports prefers-color-scheme.
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.dataset.theme = "dark";
  }

  await refresh();
})();
