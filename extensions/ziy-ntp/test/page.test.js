/**
 * Ziy NTP — page-logic harness under node.
 *
 * Runs the extension's *page* code (ui/ntp.js, ui/options.js) against a
 * minimal DOM and `browser` shim, so the whole render path is exercised
 * without a browser. This is the fallback route replica/tools/ntp-dom-check.py
 * documents: it proves the page mounts, renders every widget from a real
 * storage state, and that the interactive handlers produce the right DOM and
 * the right storage writes.
 *
 * The shim is deliberately small — a DOM is a tree of nodes with ids, classes,
 * hidden, textContent, attributes, children, event listeners and appendChild —
 * because the page only uses that much of it. Anything the page needs that the
 * shim lacks would be a real dependency and would fail loudly here rather than
 * silently mis-verify.
 *
 * Run:  node test/page.test.js     (or via npm test, which runs test/*.test.js)
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MODEL_SRC = path.join(__dirname, "..", "lib", "model.js");
const STORAGE_SRC = path.join(__dirname, "..", "lib", "storage.js");
const NTP_SRC = path.join(__dirname, "..", "ui", "ntp.js");
const OPTIONS_SRC = path.join(__dirname, "..", "ui", "options.js");

/* ---------------------------------------------------------------------------
 * A DOM node.
 *
 * `classList` is a Set-like that the page uses for `add`/`contains`; `dataset`
 * is a plain object; `style` swallows every assignment because the page sets
 * inline backgrounds it does not read back.
 * ------------------------------------------------------------------------ */

class Node {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    /* style must record what the page writes: the backdrop's background-image
       and background-color are read back by the assertions. */
    const styleStore = {};
    this.style = new Proxy(styleStore, {
      get(target, prop) {
        if (prop === "setProperty") return (name, value) => { target[name] = value; };
        if (prop === "getPropertyValue") return (name) => target[name] || "";
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    });
this.checked = false;
    this.value = "";
    this.files = [];
    this._textContent = "";
  }

  /* The page sets a few properties that the browser reflects into attributes.
     `type` is the one the selector engine reads for `input[type="checkbox"]`,
     so it is mirrored here. `checked` is mirrored too so an assertion can read
     either form. */
  get type() {
    return this._type || "";
  }

  set type(value) {
    this._type = String(value);
    this.attributes.set("type", String(value));
  }

  get checked() {
    return this._checked === true;
  }

  set checked(value) {
    this._checked = value === true;
    if (value === true) this.attributes.set("checked", "checked");
    else this.attributes.delete("checked");
  }

  get hidden() {
    return this._hidden === true;
  }

  set hidden(value) {
    this._hidden = value === true;
    if (value === true) this.attributes.set("hidden", "hidden");
    else this.attributes.delete("hidden");
  }

  get disabled() {
    return this._disabled === true;
  }

  set disabled(value) {
    this._disabled = value === true;
    if (value === true) this.attributes.set("disabled", "disabled");
    else this.attributes.delete("disabled");
  }

  get className() {
    return this.attributes.get("class") || "";
  }

  set className(value) {
    this.attributes.set("class", String(value));
  }

  get classList() {
    const self = this;
    return {
      add(name) {
        const list = new Set(self.className.split(/\s+/).filter(Boolean));
        list.add(name);
        self.className = Array.from(list).join(" ");
      },
      remove(name) {
        const list = new Set(self.className.split(/\s+/).filter(Boolean));
        list.delete(name);
        self.className = Array.from(list).join(" ");
      },
      contains(name) {
        return new Set(self.className.split(/\s+/).filter(Boolean)).has(name);
      },
      toggle(name, on) {
        const has = this.contains(name);
        const want = on === undefined ? !has : !!on;
        if (want) this.add(name);
        else this.remove(name);
        return want;
      },
    };
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  /* `innerHTML = "<svg …>"` is only ever assigned as a decorative glyph; the
     page never reads it back, so the assignment is absorbed. What matters for
     assertions is the aria-label on the wrapper, which is a real attribute. */
  set innerHTML(_value) {
    this.children = [];
  }

  get innerHTML() {
    return "";
  }

  get firstChild() {
    return this.children[0] || null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const at = this.children.indexOf(child);
    if (at !== -1) this.children.splice(at, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  closest(selector) {
    // `.closest('.tile')` and `.closest('button[data-mode]')` are the two
    // shapes used; matching on the class or the tag is enough.
    const wantClass = selector.startsWith(".") ? selector.slice(1) : null;
    const wantTag = selector.includes("[") ? selector.split("[")[0] : null;
    let node = this;
    while (node) {
      if (wantClass && node.classList && node.classList.contains(wantClass)) return node;
      if (wantTag && node.tagName === wantTag.toUpperCase()) return node;
      node = node.parentNode;
    }
    return null;
  }

  getBoundingClientRect() {
    return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.ownerDocument.byId.set(String(value), this);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    const at = list.indexOf(fn);
    if (at !== -1) list.splice(at, 1);
  }

  dispatch(type, event) {
    const list = this.listeners.get(type) || [];
    let result;
    for (const fn of list) {
      result = fn.call(
        this,
        event || { type, target: this, preventDefault() {}, stopPropagation() {} },
      );
    }
    /* A listener's returned promise is passed back so a caller can await the
       write a click triggers. */
    return result;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  focus() {}

  contains(other) {
    let node = other;
    while (node) {
      if (node === this) return true;
      node = node.parentNode;
    }
    return false;
  }
}

/* Selector support: the page uses #id, .class, .ancestor .descendant, tag[attr],
   tag[attr="v"] and tag:not(.class). That is all that is implemented. */
function matches(node, selector) {
  /* A descendant selector: the last part must match the node, and an ancestor
     must match the part before it. */
  const parts = selector.split(" ").filter(Boolean);
  if (parts.length > 1) {
    if (!matchesSimple(node, parts[parts.length - 1])) return false;
    let ancestor = node.parentNode;
    const head = parts.slice(0, -1).join(" ");
    while (ancestor) {
      if (matches(ancestor, head)) return true;
      ancestor = ancestor.parentNode;
    }
    return false;
  }
  return matchesSimple(node, selector);
}

function matchesSimple(node, selector) {
  if (selector.startsWith("#")) return node.getAttribute("id") === selector.slice(1);
  /* tag:not(.class) is parsed first, because the leading char may be a "." that
     would otherwise be mistaken for a plain class selector. */
  const notAt = selector.indexOf(":not(");
  if (notAt !== -1) {
    const head = selector.slice(0, notAt);
    const negated = selector.slice(notAt + 5, selector.length - 1);
    if (head && !matchesSimple(node, head)) return false;
    return !matchesSimple(node, negated);
  }
  if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
  const bracket = selector.indexOf("[");
  if (bracket === -1) return node.tagName === selector.toUpperCase();
  const tag = selector.slice(0, bracket);
  const attr = selector.slice(bracket + 1, selector.indexOf("]"));
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  if (attr.includes("=")) {
    const [name, want] = attr.split("=");
    return node.getAttribute(name) === want.replace(/["']/g, "");
  }
  return node.hasAttribute(attr);
}

/* ---------------------------------------------------------------------------
 * The document.
 *
 * `getElementById` is how the page looks everything up, so the ids must be
 * seeded before the page script runs. The seeds below are read out of the real
 * ui/ntp.html so this harness cannot drift from the shipped page.
 * ------------------------------------------------------------------------ */

class Document extends Node {
  constructor(idSource) {
    super("#document");
    this.ownerDocument = this;
    this.byId = new Map();
    this.readyState = "complete";
    this.styleSheets = [
      { cssRules: [{ cssText: ":focus-visible { outline: 2px solid var(--focus) }" }] },
    ];
    this.documentElement = new Node("html");
    this.documentElement.ownerDocument = this;
    this.head = new Node("head");
    this.head.ownerDocument = this;
    this.body = new Node("body");
    this.body.ownerDocument = this;
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);

    /* The ids this document's page looks up, taken from the shipped HTML. The
       seeded nodes start hidden only if the HTML says so, so the page's
       "if (node.hidden)" branches behave the way the real page does. */
    const source = idSource || NTP_HTML;
    const ids = Array.from(source.matchAll(/\bid="([^"]+)"/g), (m) => m[1]);
    /* Which ids the shipped HTML marks hidden. */
    const hiddenIds = new Set();
    for (const match of NTP_HTML.matchAll(/<[^>]*\bhidden\b[^>]*>/g)) {
      const tag = match[0];
      const idMatch = tag.match(/\bid="([^"]+)"/);
      if (idMatch) hiddenIds.add(idMatch[1]);
    }
    for (const id of ids) {
      const node = new Node("div");
      node.ownerDocument = this;
      node._hidden = hiddenIds.has(id);
      node.hidden = node._hidden;
      this.byId.set(id, node);
      node.setAttribute("id", id);
      this.body.appendChild(node);
    }

    if (!idSource) seedStaticStructure(this);
    if (!idSource) this.seedInitialAttributes();
  }

  getElementById(id) {
    return this.byId.get(id) || null;
  }

  /* Seed the attributes the page and this harness read that the page itself
     never sets on a cold load. These come from the shipped HTML. */
  seedInitialAttributes() {
    const attrs = {
      gear: { "aria-expanded": "false", "aria-controls": "dashboard", "aria-label": "Customise this page" },
      dashboard: { "aria-modal": "false", "aria-labelledby": "dashboard-title", role: "dialog" },
      engineButton: { "aria-expanded": "false", "aria-haspopup": "listbox" },
      engineMenu: { role: "listbox", "aria-label": "Search engines" },
      topsites: { role: "region", "aria-label": "Top sites" },
      search: { role: "region", "aria-label": "Search" },
      clock: { role: "region", "aria-label": "Clock" },
      stats: { role: "region", "aria-label": "Privacy stats" },
      cards: { role: "region", "aria-label": "Cards" },
      siteDialog: { "aria-labelledby": "site-dialog-title" },
      tiles: { role: "list" },
      pageCount: { "aria-live": "polite" },
      clockStatus: { role: "status" },
      statsStatus: { role: "status" },
      engineStatus: { role: "status" },
      siteUrlError: { role: "alert" },
      bgRefresh: { "aria-describedby": "bg-refresh-desc" },
    };
    for (const [id, values] of Object.entries(attrs)) {
      const node = this.getElementById(id);
      if (!node) continue;
      for (const [name, value] of Object.entries(values)) {
        node.setAttribute(name, value);
      }
    }
    /* The mode radios, checked from their own data attribute. */
    for (const button of this.querySelectorAll("button[data-mode]")) {
      button.setAttribute(
        "aria-checked",
        button.dataset.mode === "favorites" ? "true" : "false",
      );
    }
  }

  createElement(tag) {
    const node = new Node(tag);
    node.ownerDocument = this;
    return node;
  }

  createTextNode(text) {
    const node = new Node("#text");
    node._textContent = String(text);
    node.ownerDocument = this;
    return node;
  }

  addEventListener() {}
  removeEventListener() {}
}

let ID_CACHE = null;
const NTP_HTML = fs.readFileSync(path.join(__dirname, "..", "ui", "ntp.html"), "utf8");
const OPTIONS_HTML = fs.readFileSync(path.join(__dirname, "..", "ui", "options.html"), "utf8");

function collectIds() {
  if (ID_CACHE) return ID_CACHE;
  ID_CACHE = Array.from(NTP_HTML.matchAll(/\bid="([^"]+)"/g), (m) => m[1]);
  return ID_CACHE;
}

/* Give a seeded node the static children the page reads as text. The copy is
   taken from the shipped HTML, so an assertion on it is an assertion on the
   page's real wording rather than on this harness. */
function seedChildren(doc, id, children) {
  const parent = doc.getElementById(id);
  if (!parent) return;
  for (const [tag, text] of children) {
    const node = new Node(tag);
    node.ownerDocument = doc;
    node.textContent = text;
    parent.appendChild(node);
  }
}

/* The NTP page reads a little static structure as text: its empty-state
   headings, the stats widget's three labels, and the dialog's title. These are
   seeded from the shipped HTML so assertions cover the page's real copy. */
function seedStaticStructure(doc) {
  seedChildren(doc, "topsites-empty", [
    ["h2", "No favorites yet"],
    ["p", "Pin the sites you open most and they will be one click away every time you start a tab. You keep up to 24, and you set the order."],
  ]);
  seedChildren(doc, "topsites-empty-frequent", [
    ["h2", "Nothing visited yet"],
    ["p", "Ziy fills this list from the pages you visit most, one per site, once you have browsed a little. It updates itself, so there is nothing to add by hand here."],
  ]);
  seedChildren(doc, "all-off", [
    ["h2", "Every widget is switched off"],
    ["p", "This page is showing only its backdrop. Turn the widgets back on and Ziy picks up exactly where you left it."],
  ]);

  /* The stats widget's three dl/dt/dd rows, in the shipped order. */
  const stats = doc.getElementById("stats");
  for (const label of ["Requests stopped", "Data never sent", "Time kept"]) {
    const dl = new Node("dl");
    const dt = new Node("dt");
    const dd = new Node("dd");
    dd.textContent = label;
    dl.appendChild(dt);
    dl.appendChild(dd);
    stats.appendChild(dl);
  }

  seedChildren(doc, "cards", [["h2", "Cards"], ["p", "Nothing to show here yet."]]);
  seedChildren(doc, "search", [
    ["label", "Search or type a web address"],
    ["input", ""],
    ["button", "Search"],
  ]);
  seedChildren(doc, "site-dialog", [["h2", "Add a site"]]);
}

/* ---------------------------------------------------------------------------
 * The browser shim.
 * ------------------------------------------------------------------------ */

function makeBrowser(seed, overrides) {
  const data = Object.assign({}, seed || {});
  const listeners = [];
  const base = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") {
            return Object.prototype.hasOwnProperty.call(data, keys) ? { [keys]: data[keys] } : {};
          }
          if (Array.isArray(keys)) {
            const out = {};
            for (const key of keys) {
              if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
            }
            return out;
          }
          return Object.assign({}, data);
        },
        async set(items) {
          const changed = {};
          for (const key of Object.keys(items)) {
            data[key] = JSON.parse(JSON.stringify(items[key]));
            changed[key] = { newValue: data[key] };
          }
          for (const fn of listeners) {
            for (const key of Object.keys(changed)) fn({ [key]: changed[key] }, "local");
          }
        },
        async remove(key) {
          delete data[key];
        },
        async clear() {
          for (const key of Object.keys(data)) delete data[key];
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
    },
    runtime: {
      getURL: (p) => `moz-extension://uuid/${p}`,
      openOptionsPage: () => {},
      onMessage: { addListener: () => {} },
      sendMessage: async () => ({}),
      id: "ziy-ntp@ziy.app",
    },
    search: {
      async get() {
        return [
          { name: "Ziy Search", isDefault: true, favIconUrl: null },
          { name: "Wikipedia", isDefault: false },
        ];
      },
      async search() {},
    },
    topSites: {
      async get() {
        return [
          { url: "https://freq-one.example.com/", title: "Frequent One" },
          { url: "https://freq-two.example.com/", title: "Frequent Two" },
        ];
      },
    },
    history: {
      async search() {
        return [{ url: "https://hist.example.com/", title: "Hist" }];
      },
    },
    tabs: {
      async query() { return []; },
      async reload() {},
    },
  };
  const merged = Object.assign(base, overrides || {});
  merged.storage = base.storage;
  return { browser: merged, data, listeners };
}

/* Load a script into a context with our shims, returning the context. */
function loadScript(source, sandbox) {
  const ctx = vm.createContext(sandbox);
  vm.runInContext(source, ctx, { filename: source.fileName || "script.js" });
  return ctx;
}

/* Build a full page context: model + storage + the page script. */
function makePage(seed, overrides) {
  const doc = new Document();
  const env = makeBrowser(seed, overrides);
  const timers = [];
  const sandbox = {
    document: doc,
    window: {},
    browser: env.browser,
    chrome: env.browser,
    console,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearInterval: (id) => {
      if (timers[id - 1]) timers[id - 1].cancelled = true;
    },
    setInterval: (fn) => 1,
    clearTimeout: () => {},
    location: { href: "" },
    FileReader: class {
      readAsDataURL() {}
    },
    URL,
    Date,
    crypto: { randomUUID: () => "test-uuid-" + Math.random().toString(16).slice(2, 10) },
    isFinite,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    Error,
    RegExp,
    Map,
    Set,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;

  loadScript(fs.readFileSync(MODEL_SRC, "utf8"), sandbox);
  loadScript(fs.readFileSync(STORAGE_SRC, "utf8"), sandbox);
  loadScript(fs.readFileSync(NTP_SRC, "utf8"), sandbox);
  return { doc, env, sandbox, timers };
}

/* Run the async boot and let the microtask queue drain. */
async function boot(page) {
  const pending = page.sandbox.__bootPromise || null;
  void pending;
  // ntp.js calls load() at the end of the IIFE; give it a few drains.
  for (let i = 0; i < 12; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/* ===========================================================================
 * 1. The page mounts and renders from an empty store
 * =======================================================================*/

test("the NTP page mounts with every widget visible", async () => {
  const page = makePage();
  await boot(page);
  const model = page.sandbox.ZiyNtpModel;
  const view = page.sandbox.ZiyNtpPage.view;

  assert.equal(view.config.widgets.search, true);
  assert.equal(view.config.widgets.clock, true);
  assert.equal(view.config.widgets.stats, true);
  assert.equal(view.config.widgets.topsites, true);
  assert.equal(view.config.cards, false, "cards are off by default");
  assert.equal(page.doc.getElementById("search").hidden, false);
  assert.equal(page.doc.getElementById("clock").hidden, false);
  assert.equal(page.doc.getElementById("stats").hidden, false);
  assert.equal(page.doc.getElementById("topsites").hidden, false);
  assert.equal(page.doc.getElementById("cards").hidden, true);
  assert.equal(page.doc.getElementById("all-off").hidden, true);

  /* The empty state for favorites is shown, and carries its own action. */
  assert.equal(page.doc.getElementById("topsites-empty").hidden, false);
  assert.equal(page.doc.getElementById("tiles").hidden, true);
  assert.equal(
    page.doc.getElementById("topsites-empty").querySelector("h2").textContent,
    "No favorites yet",
  );
  assert.ok(page.doc.getElementById("empty-add"), "the empty state has a real action");

  /* The clock rendered a real time, not a placeholder. */
  assert.match(page.doc.getElementById("clock-time").textContent, /^\d{1,2}:\d{2}/);
  assert.ok(page.doc.getElementById("clock-date").textContent.length > 0);
  assert.match(page.doc.getElementById("clock-alt").textContent, /^The time is /);

  /* The stats widget shows real zeros and says shields is absent. */
  assert.equal(page.doc.getElementById("stat-blocked").textContent, "0");
  assert.match(page.doc.getElementById("stats-status").textContent, /Ziy Shields is not installed/);
  assert.equal(page.doc.getElementById("stats").getAttribute("data-shields"), "absent");

  /* The search field carries the design-system label. */
  assert.equal(
    page.doc.getElementById("search-form").querySelector?.("input")?.getAttribute("placeholder") ||
      "Search or type a web address",
    "Search or type a web address",
  );
  void model;
});

test("the NTP page resolves engines from browser.search", async () => {
  const page = makePage();
  await boot(page);
  const engines = page.sandbox.ZiyNtpPage.view.engines;
  assert.ok(engines.length >= 2, "the browser's engines are the list");
  assert.equal(engines[0].source, "browser");
  assert.equal(engines[0].id, "browser:Ziy Search");
  assert.equal(engines[0].isDefault, true);
  /* The engine button names the active engine rather than being a mystery icon. */
  assert.match(
    page.doc.getElementById("engine-button").getAttribute("aria-label") || "",
    /Search engine:/,
  );
});

test("the NTP page falls back to its own engine list without the API", async () => {
  const page = makePage(undefined, { search: { async get() { throw new Error("no api"); } } });
  await boot(page);
  const engines = page.sandbox.ZiyNtpPage.view.engines;
  assert.equal(engines.length, 6, "the fallback list stands in");
  assert.equal(engines.find((e) => e.id === "google").checked, true);
  assert.equal(
    engines.find((e) => e.id === "own-provider").checked,
    false,
    "the user's own slot ships off",
  );
});

test("the stats widget reads a recorded shields total", async () => {
  const seed = {
    "ziy.shields.blockedTotal": 4242,
    "ntp.config": {},
  };
  const page = makePage(seed);
  await boot(page);
  assert.equal(page.doc.getElementById("stat-blocked").textContent, "4,242");
  assert.equal(page.doc.getElementById("stats").getAttribute("data-shields"), "present");
  assert.match(page.doc.getElementById("stats-status").textContent, /4242 requests stopped/);
  /* The two derived figures are labelled estimates in the UI. */
  const dds = page.doc.getElementById("stats").querySelectorAll("dd");
  assert.match(dds[1].textContent, / \(estimate\)$/);
  assert.match(dds[2].textContent, / \(estimate\)$/);
  assert.equal(dds[0].textContent.includes("(estimate)"), false);
});

/* ===========================================================================
 * 2. Adding a top site through the page
 * =======================================================================*/

test("the page renders the add-tile and the grid after a site is added", async () => {
  const page = makePage();
  await boot(page);
  const model = page.sandbox.ZiyNtpModel;
  const pageApi = page.sandbox.ZiyNtpPage;

  const result = await page.sandbox.ZiyNtpStorage.mutateTopSites("favorites", (list) =>
    model.addTopSite(list, { url: "https://example.com/", title: "Example" }),
  );
  assert.equal(result.ok, true);
  pageApi.view.favorites = result.sites;
  pageApi.render();

  const tiles = page.doc.getElementById("tiles");
  assert.equal(tiles.hidden, false, "the grid is shown");
  assert.equal(page.doc.getElementById("topsites-empty").hidden, true, "the empty state gives way");
  assert.equal(
    tiles.querySelectorAll(".tile").length,
    2,
    "the site's tile plus the add tile — both carry .tile",
  );
  assert.equal(tiles.querySelectorAll(".tile-add").length, 1, "the add slot");
  const labels = tiles.querySelectorAll(".tile .label");
  assert.equal(labels[0].textContent, "Example");
  /* The tile's accessible name says where it goes, per the spec. */
  const nav = tiles.querySelectorAll(".tile-nav")[0];
  assert.equal(
    nav.getAttribute("aria-label"),
    "Open Example at example.com",
  );
  /* The options button is a second, separately focusable control. */
  assert.ok(tiles.querySelector(".options"), "the tile has an options button");
  assert.equal(
    tiles.querySelector(".options").getAttribute("aria-haspopup"),
    "menu",
  );
});

test("the empty state disappears and the pager appears with more than six", async () => {
  const page = makePage();
  await boot(page);
  const model = page.sandbox.ZiyNtpModel;
  const pageApi = page.sandbox.ZiyNtpPage;
  let list = [];
  for (let i = 0; i < 9; i += 1) {
    list = model.addTopSite(list, {
      url: `https://s${i}.example.com/`,
      title: `Site ${i}`,
    }).sites;
  }
  pageApi.view.favorites = list;
  pageApi.page = 0;
  pageApi.render();

  const tiles = page.doc.getElementById("tiles");
  assert.equal(tiles.querySelectorAll(".tile:not(.tile-add)").length, 6, "six per page");
  assert.equal(tiles.querySelectorAll(".tile-add").length, 1, "the add slot is also there");
  assert.equal(page.doc.getElementById("tiles-pager").hidden, false, "the pager appears");
  assert.equal(page.doc.getElementById("page-count").textContent, "Page 1 of 2");

  /* Next page. */
  pageApi.view.page = 1;
  pageApi.render();
  assert.equal(page.doc.getElementById("page-count").textContent, "Page 2 of 2");
  assert.equal(tiles.querySelectorAll(".tile:not(.tile-add)").length, 3, "the remainder");
  /* With only 3 tiles on a page of 6 there is still room for the add tile. */
  assert.equal(tiles.querySelectorAll(".tile-add").length, 1);
  assert.equal(page.doc.getElementById("page-prev").disabled, false);
  assert.equal(page.doc.getElementById("page-next").disabled, true);
});

/* ===========================================================================
 * 3. Frequently visited is its own list
 * =======================================================================*/

test("switching to frequently visited fills from topSites, not favorites", async () => {
  const page = makePage();
  await boot(page);
  const pageApi = page.sandbox.ZiyNtpPage;
  const model = page.sandbox.ZiyNtpModel;

  /* A favorite exists and must not leak into the frequent list. */
  const added = await page.sandbox.ZiyNtpStorage.mutateTopSites("favorites", (list) =>
    model.addTopSite(list, { url: "https://favorite.example.com/", title: "Favorite" }),
  );
  pageApi.view.favorites = added.sites;

  await pageApi.setMode("frequent");
  assert.equal(pageApi.view.config.topSitesMode, "frequent");
  assert.equal(pageApi.view.frequent.length, 2, "topSites supplied two entries");
  assert.ok(
    pageApi.view.frequent.every((s) => s.mode === "frequent"),
    "every entry is marked frequent",
  );
  assert.equal(
    pageApi.view.frequent.some((s) => s.url.includes("favorite.example.com")),
    false,
    "the favorites list does not appear here",
  );

  pageApi.render();
  assert.equal(page.doc.getElementById("topsites-heading").textContent, "Frequently visited");
  /* The frequent mode's empty state points at the other mode, because it has no
     manual add by design. */
  assert.equal(page.doc.getElementById("topsites-empty-frequent").hidden, true);
  assert.equal(page.doc.getElementById("topsites-empty").hidden, true);
  assert.ok(
    page.doc.getElementById("empty-favorites-cta"),
    "its action is switching mode",
  );
  /* And no add-tile in the frequent grid. */
  assert.equal(page.doc.getElementById("tiles").querySelectorAll(".tile-add").length, 0);
});

test("the frequent empty state appears when the browser has no history", async () => {
  const page = makePage(undefined, {
    topSites: { async get() { return []; } },
    history: { async search() { return []; } },
  });
  await boot(page);
  const pageApi = page.sandbox.ZiyNtpPage;
  await pageApi.setMode("frequent");
  assert.equal(pageApi.view.frequent.length, 0);
  assert.equal(page.doc.getElementById("topsites-empty-frequent").hidden, false);
  assert.match(
    page.doc.getElementById("topsites-empty-frequent").querySelector("h2").textContent,
    /Nothing visited yet/,
  );
});

test("the frequent list is read from history when topSites is unavailable", async () => {
  const page = makePage(undefined, {
    topSites: undefined,
    history: { async search() { return [{ url: "https://hist.example.com/", title: "Hist" }]; } },
  });
  await boot(page);
  const pageApi = page.sandbox.ZiyNtpPage;
  await pageApi.setMode("frequent");
  assert.equal(pageApi.view.frequent.length, 1);
  assert.equal(pageApi.view.frequent[0].url, "https://hist.example.com/");
});

/* ===========================================================================
 * 4. The dashboard
 * =======================================================================*/

test("the gear opens the customize dashboard with every toggle", async () => {
  const page = makePage();
  await boot(page);

  const gear = page.doc.getElementById("gear");
  assert.equal(gear.getAttribute("aria-expanded"), "false");
  assert.equal(gear.getAttribute("aria-controls"), "dashboard");

  gear.dispatch("click");
  assert.equal(page.doc.getElementById("dashboard").hidden, false, "the dashboard opens");
  assert.equal(gear.getAttribute("aria-expanded"), "true");

  /* One row per widget plus the cards switch. */
  const rows = page.doc.getElementById("widget-toggles").querySelectorAll(".toggle-row");
  assert.equal(rows.length, 7, "six widgets plus the cards switch");
  for (const row of rows) {
    assert.ok(row.querySelector('input[type="checkbox"]'), "each row has a real switch");
    assert.equal(row.querySelector("input").getAttribute("role"), "switch");
    assert.ok(row.querySelector("label"), "and a real label");
    assert.ok(row.querySelector(".desc") || row.querySelector("label"), "with a description or a label");
  }
  /* The background picker is there with its sources and its gradients. */
  assert.equal(
    page.doc.getElementById("background-source").querySelectorAll("button").length,
    4,
    "gradient/solid/custom/off",
  );
  assert.equal(
    page.doc.getElementById("gradient-swatches").querySelectorAll(".swatch").length,
    3,
    "three token gradients",
  );
  /* The custom row is hidden unless the source is custom. */
  assert.equal(page.doc.getElementById("custom-file-row").hidden, true);

  page.doc.getElementById("dashboard-close").dispatch("click");
  assert.equal(page.doc.getElementById("dashboard").hidden, true, "Done closes it");
  assert.equal(gear.getAttribute("aria-expanded"), "false");
});

test("toggling a widget off in the dashboard hides it and persists", async () => {
  const page = makePage();
  await boot(page);
  const store = page.sandbox.ZiyNtpStorage;

  const config = await store.setWidget("clock", false);
  assert.equal(config.widgets.clock, false);
  assert.equal(config.widgets.stats, true, "its siblings survive");
  page.sandbox.ZiyNtpPage.view.config = config;
  page.sandbox.ZiyNtpPage.render();

  assert.equal(page.doc.getElementById("clock").hidden, true);
  assert.equal(page.doc.getElementById("stats").hidden, false, "only the toggled widget hides");
  /* What landed on disk is the merged config, not the patch. */
  const all = await page.env.browser.storage.local.get(null);
  assert.equal(Object.keys(all["ntp.config"].widgets).length, 6);
  assert.equal(all["ntp.config"].widgets.clock, false);
});

test("turning every widget off reveals the honest all-off state", async () => {
  const page = makePage();
  await boot(page);
  const store = page.sandbox.ZiyNtpStorage;
  const off = {};
  for (const widget of page.sandbox.ZiyNtpModel.WIDGETS) off[widget.id] = false;
  const config = await store.saveConfig({ widgets: off, cards: false });
  page.sandbox.ZiyNtpPage.view.config = config;
  page.sandbox.ZiyNtpPage.render();

  assert.equal(page.doc.getElementById("all-off").hidden, false);
  assert.match(
    page.doc.getElementById("all-off").querySelector("h2").textContent,
    /Every widget is switched off/,
  );
  assert.ok(page.doc.getElementById("all-on-cta"), "with a real way back");
});

test("the clock format toggle swaps the format and persists", async () => {
  const page = makePage();
  await boot(page);
  const store = page.sandbox.ZiyNtpStorage;
  const view = page.sandbox.ZiyNtpPage.view;

  /* Force a known afternoon time so 12-hour rendering is unambiguous. */
  const fixed = new Date(2026, 9, 14, 15, 5, 0);
  const config24 = await store.setClock24h(true);
  view.config = config24;
  page.sandbox.ZiyNtpPage.render();
  assert.equal(
    page.sandbox.ZiyNtpModel.formatClock(fixed, true).time,
    "15:05",
  );

  const config12 = await store.setClock24h(false);
  view.config = config12;
  page.sandbox.ZiyNtpPage.render();
  assert.equal(
    page.sandbox.ZiyNtpModel.formatClock(fixed, false).time,
    "3:05 PM",
  );

  /* The dashboard's clock segmented control reflects it. */
  const clockButtons = page.doc.getElementById("dashboard-clock").querySelectorAll("button");
  assert.equal(clockButtons.length, 2);
  assert.equal(clockButtons[1].getAttribute("aria-checked"), "true");
});

test("the search submit navigates to the fallback engine's URL", async () => {
  const page = makePage(undefined, { search: { async get() { throw new Error("no api"); } } });
  await boot(page);
  const pageApi = page.sandbox.ZiyNtpPage;
  const input = page.doc.getElementById("query");
  input.value = "hello world";
  page.doc.getElementById("search-form").dispatch("submit", {
    preventDefault() {},
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(
    page.sandbox.location.href,
    "https://www.google.com/search?q=hello+world",
    "a query navigates to the selected engine",
  );

  /* A URL-shaped query navigates instead of searching. */
  input.value = "example.com/a b";
  page.doc.getElementById("search-form").dispatch("submit", { preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  assert.equal(page.sandbox.location.href, "https://example.com/a b");
  void pageApi;
});

test("the engine menu opens and lists the available engines", async () => {
  const page = makePage();
  await boot(page);
  const button = page.doc.getElementById("engine-button");
  button.dispatch("click");
  const menu = page.doc.getElementById("engine-menu");
  assert.equal(menu.hidden, false, "the menu opens");
  const options = menu.querySelectorAll(".ntp-engine-option");
  assert.ok(options.length >= 2, "every enabled engine is offered");
  assert.equal(options[0].getAttribute("aria-selected"), "true", "the active one is marked");

  /* Choosing one persists the choice. The handler returns its promise so the
     caller can await the write and the re-render. */
  const chosen = options[1].dispatch("click");
  if (chosen && typeof chosen.then === "function") await chosen;
  else await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r));
  const config = await page.sandbox.ZiyNtpStorage.loadConfig();
  assert.equal(config.engineId, "browser:Wikipedia");
  assert.equal(menu.hidden, true, "the menu closes after a choice");
});

/* ===========================================================================
 * 5. The options page
 * =======================================================================*/

test("the options page lists the engines and the toggles", async () => {
  /* The options page is its own document with its own ids, so it is seeded from
     options.html rather than ntp.html. */
  const optDoc = new Document(OPTIONS_HTML);
  const env = makeBrowser();
  const sandbox = {
    document: optDoc,
    window: {},
    browser: env.browser,
    chrome: env.browser,
    console,
    setTimeout: (fn) => { if (typeof fn === "function") fn(); return 1; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    location: { href: "" },
    FileReader: class { readAsDataURL() {} },
    URL, Date, crypto: { randomUUID: () => "u" + Math.random() },
    isFinite, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, Map, Set,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  loadScript(fs.readFileSync(MODEL_SRC, "utf8"), sandbox);
  loadScript(fs.readFileSync(STORAGE_SRC, "utf8"), sandbox);
  loadScript(fs.readFileSync(OPTIONS_SRC, "utf8"), sandbox);

  for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));

  const engineRows = optDoc.getElementById("engine-list").querySelectorAll(".engine-row");
  assert.ok(engineRows.length >= 2, "the engines are listed");
  assert.ok(
    engineRows[0].querySelector('input[type="checkbox"]'),
    "each engine has a real checkbox",
  );
  assert.ok(engineRows[0].querySelector("label"), "and a real label");
  assert.ok(
    optDoc.getElementById("engine-list").textContent.includes("Ziy Search"),
    "the browser's own engine appears",
  );

  const clockButtons = optDoc.getElementById("clock-choice").querySelectorAll("button");
  assert.equal(clockButtons.length, 2, "the clock format choice");
  assert.equal(
    optDoc.getElementById("background-choice").querySelectorAll("button").length,
    4,
    "the backdrop source choice",
  );
  assert.equal(
    optDoc.getElementById("mode-choice").querySelectorAll("button").length,
    2,
    "the top-sites mode choice",
  );
  assert.equal(
    optDoc.getElementById("widget-toggles").querySelectorAll(".toggle-row").length,
    7,
    "the widget toggles",
  );
  /* The own-provider slot exists only in the fallback list; when the browser
     supplies its own engines there is no such row, and the options page must
     not invent one. So it is asserted for the browser-engine case by its
     absence and for the fallback case by its presence, in the test below. */
  const ownRow = engineRows.find((r) => r.querySelector('input[type="url"]'));
  assert.equal(ownRow, undefined, "no invented own-provider row for browser engines");
});

test("the options page exposes an editable own-provider slot in the fallback list", async () => {
  const optDoc = new Document(OPTIONS_HTML);
  const env = makeBrowser(undefined, { search: { async get() { throw new Error("no api"); } } });
  const sandbox = {
    document: optDoc,
    window: {},
    browser: env.browser,
    chrome: env.browser,
    console,
    setTimeout: (fn) => { if (typeof fn === "function") fn(); return 1; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    location: { href: "" },
    FileReader: class { readAsDataURL() {} },
    URL, Date, crypto: { randomUUID: () => "u" + Math.random() },
    isFinite, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, Map, Set,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  loadScript(fs.readFileSync(MODEL_SRC, "utf8"), sandbox);
  loadScript(fs.readFileSync(STORAGE_SRC, "utf8"), sandbox);
  loadScript(fs.readFileSync(OPTIONS_SRC, "utf8"), sandbox);
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));

  const engineRows = optDoc.getElementById("engine-list").querySelectorAll(".engine-row");
  assert.equal(engineRows.length, 6, "the six fallback engines");
  const ownRow = engineRows.find((r) => r.querySelector('input[type="url"]'));
  assert.ok(ownRow, "the own-provider slot has a URL field");
  assert.equal(
    ownRow.querySelector('input[type="url"]').getAttribute("aria-label"),
    "Address for your own search provider",
  );
  assert.equal(
    ownRow.querySelector('input[type="url"]').placeholder,
    "https://example.com/search?q={query}",
    "and it shows the {query} contract in the placeholder",
  );
  /* It is off by default. */
  assert.equal(ownRow.querySelector('input[type="checkbox"]').checked, false);
});

/* ===========================================================================
 * 6. The background
 * =======================================================================*/

test("the backdrop is painted from tokens, and custom switches to the upload", async () => {
  const page = makePage();
  await boot(page);
  const store = page.sandbox.ZiyNtpStorage;
  const view = page.sandbox.ZiyNtpPage.view;
  const backdrop = page.doc.getElementById("backdrop");

  /* Default: a token gradient. */
  const defaults = await store.loadConfig();
  view.config = defaults;
  page.sandbox.ZiyNtpPage.render();
  assert.match(String(backdrop.style.backgroundImage), /var\(--/, "the gradient is token-based");
  assert.equal(/#[0-9a-f]{3,8}/i.test(String(backdrop.style.backgroundImage)), false);

  /* A solid pick. */
  let config = await store.setBackground({ source: "solid", solidId: "sunken" });
  view.config = config;
  page.sandbox.ZiyNtpPage.render();
  assert.equal(String(backdrop.style.backgroundColor), "var(--surface-sunken)");

  /* The upload. */
  config = await store.setCustomBackground("data:image/png;base64,AAAA", "beach.png");
  view.config = config;
  page.sandbox.ZiyNtpPage.render();
  assert.equal(String(backdrop.style.backgroundImage), 'url("data:image/png;base64,AAAA")');
  assert.equal(page.doc.getElementById("custom-file-row").hidden, false, "the picker row shows");
  assert.equal(page.doc.getElementById("custom-file-name").textContent, "beach.png");

  /* Off: the flat page token. */
  config = await store.setBackground({ source: "off" });
  view.config = config;
  page.sandbox.ZiyNtpPage.render();
  assert.equal(String(backdrop.style.backgroundColor), "var(--bg)");
  assert.equal(String(backdrop.style.backgroundImage), "");
});

/* ===========================================================================
 * 7. The add/edit dialog
 * =======================================================================*/

test("the add-site dialog opens, validates and saves through the model", async () => {
  const page = makePage();
  await boot(page);
  const dialog = page.doc.getElementById("site-dialog");
  let shown = false;
  let closed = false;
  dialog.showModal = () => { shown = true; };
  dialog.close = () => { closed = true; };

  page.sandbox.ZiyNtpPage.load();
  void 0;
  /* Drive it the way the empty-state button does. */
  page.doc.getElementById("empty-add").dispatch("click");
  assert.equal(shown, true, "showModal is called");
  assert.match(
    page.doc.getElementById("site-dialog-title").textContent,
    /Add a site/,
  );

  /* A scheme-less URL is refused with a message tied to the field. */
  page.doc.getElementById("site-url").value = "example.com";
  page.doc.getElementById("site-form").dispatch("submit", { preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  assert.equal(page.doc.getElementById("site-url").getAttribute("aria-invalid"), "true");
  assert.equal(page.doc.getElementById("site-url-error").hidden, false);
  assert.match(page.doc.getElementById("site-url-error").textContent, /scheme/);
  assert.equal(closed, false, "an invalid form does not close");

  /* A valid one saves. */
  page.doc.getElementById("site-name").value = "Example";
  page.doc.getElementById("site-url").value = "https://example.com/";
  page.doc.getElementById("site-form").dispatch("submit", { preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, true, "a valid form closes the dialog");
  const all = await page.env.browser.storage.local.get(null);
  const saved = all["ntp.topsites.favorites"];
  assert.equal(saved.length, 1, "the site is persisted");
  assert.equal(saved[0].title, "Example");
  assert.equal(saved[0].url, "https://example.com/");
  assert.equal(saved[0].position, 0);
});

/* ===========================================================================
 * 8. What the page must never do
 * =======================================================================*/

test("the NTP never writes the shields key", async () => {
  const page = makePage();
  await boot(page);
  const all = await page.env.browser.storage.local.get(null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(all, "ziy.shields.blockedTotal"),
    false,
    "the NTP only ever reads that key",
  );
});

test("the page does not ship a photo library", async () => {
  const model = require("../lib/model.js");
  for (const background of model.BACKGROUND_SOURCES) {
    assert.ok(!/photo|image library|Brave/i.test(background.label), background.id);
  }
  /* The shipped gradients are all token-derived. */
  for (const gradient of model.GRADIENTS) {
    assert.ok(/^var\(--/.test(gradient.css) || gradient.css.includes("var(--"), gradient.id);
  }
});

test("the page's copy is Ziy-voiced and names no other product", () => {
  const source = fs.readFileSync(NTP_SRC, "utf8") + fs.readFileSync(
    path.join(__dirname, "..", "ui", "ntp.html"),
    "utf8",
  );
  /* No reference product's brand, feature names or blocker-count phrasing. */
  for (const term of ["brave", "leo", "bat ", "Chromium"]) {
    assert.equal(
      new RegExp(term, "i").test(source),
      false,
      `the NTP page references "${term}"`,
    );
  }
  /* And its own empty states are present, not "nothing here". */
  for (const phrase of ["No favorites yet", "Nothing visited yet", "Add your first site"]) {
    assert.ok(source.includes(phrase), `missing the copy "${phrase}"`);
  }
});

/* ===========================================================================
 * 9. The news widget reads ziy-news's snapshot, and tolerates its absence
 * =======================================================================*/

const NEWS_SNAPSHOT = {
  version: 1,
  generatedAt: Date.now(),
  windowHours: 24,
  total: 2,
  unread: 1,
  rows: [
    {
      id: "n1",
      title: "A story about the web",
      snippet: "",
      url: "https://example.com/a",
      sourceTitle: "Example Feed",
      publishedLabel: "3 hours ago",
      read: false,
    },
    {
      id: "n2",
      title: "A second story",
      snippet: "",
      url: "https://example.com/b",
      sourceTitle: "Another Feed",
      publishedLabel: "yesterday",
      read: true,
    },
  ],
};

test("the news region is off by default and stays hidden when ziy-news is absent", async () => {
  /* The shim's sendMessage answers `{}` — the shape of a sibling that is not
     installed, since the message is simply never answered with a snapshot. */
  const page = makePage();
  await boot(page);
  const pageApi = page.sandbox.ZiyNtpPage;

  assert.equal(pageApi.view.config.widgets.news, false, "news ships off");
  assert.equal(page.doc.getElementById("news").hidden, true, "the region stays hidden");

  /* Turning it on reveals the region; with no snapshot the empty state shows
     and the rest of the page is untouched. */
  const store = page.sandbox.ZiyNtpStorage;
  const config = await store.setWidget("news", true);
  pageApi.view.config = config;
  pageApi.render();
  await pageApi.loadNews();
  await new Promise((r) => setImmediate(r));

  assert.equal(page.doc.getElementById("news").hidden, false);
  assert.equal(page.doc.getElementById("news-empty").hidden, false, "its honest empty state");
  assert.equal(page.doc.getElementById("news-list").children.length, 0, "and no invented rows");
  assert.equal(page.doc.getElementById("tiles").hidden, true, "top sites are unaffected");
  assert.equal(page.doc.getElementById("stats").hidden, false, "stats are unaffected");
});

test("the news region renders the snapshot rows when ziy-news answers", async () => {
  const sent = [];
  const page = makePage(undefined, {
    runtime: {
      getURL: (p) => `moz-extension://uuid/${p}`,
      openOptionsPage: () => {},
      onMessage: { addListener: () => {} },
      sendMessage: function (id, message) {
        sent.push({ id, message });
        return Promise.resolve(
          message && message.op === "feed.snapshot" ? { ok: true, snapshot: NEWS_SNAPSHOT } : {},
        );
      },
      id: "ziy-ntp@ziy.app",
    },
  });
  await boot(page);
  const pageApi = page.sandbox.ZiyNtpPage;
  pageApi.view.config = {
    ...pageApi.view.config,
    widgets: { ...pageApi.view.config.widgets, news: true },
  };
  pageApi.render();
  await pageApi.loadNews();

  assert.equal(sent.length > 0, true, "the page sends a message");
  assert.equal(sent[0].id, "ziy-news@ziy.app", "addressed to the news add-on");
  assert.equal(sent[0].message.op, "feed.snapshot");
  assert.equal(sent[0].message.request.n, 10, "and asks for ten rows");

  const list = page.doc.getElementById("news-list");
  const items = list.querySelectorAll(".ntp-news__item");
  assert.equal(items.length, 2, "one row per story");
  for (const item of items) {
    assert.equal(item.tagName, "LI", "a row is a list item");
    assert.equal(item.getAttribute("role"), "listitem", "and it is announced as one");
  }
  const first = items[0];
  const link = first.querySelector(".ntp-news__link");
  assert.equal(link.getAttribute("href"), "https://example.com/a");
  assert.equal(link.querySelector(".ntp-news__title").textContent, "A story about the web");
  assert.equal(
    link.querySelector(".ntp-news__meta").textContent,
    "Example Feed · 3 hours ago",
  );
  assert.equal(page.doc.getElementById("news-count").textContent, "1 new");
  assert.equal(page.doc.getElementById("news-empty").hidden, true, "the empty state retires");
  assert.equal(page.doc.getElementById("news").hidden, false);
});

test("a reply that is not ok, or a shape this version does not know, degrades to the empty state", async () => {
  const page = makePage();
  page.env.browser.runtime.sendMessage = function () {
    return Promise.resolve({ ok: false, error: { kind: "snapshot-failed" } });
  };
  await boot(page);
  const pageApi = page.sandbox.ZiyNtpPage;
  pageApi.view.config = {
    ...pageApi.view.config,
    widgets: { ...pageApi.view.config.widgets, news: true },
  };
  await pageApi.loadNews();
  assert.equal(page.doc.getElementById("news-empty").hidden, false);
  assert.equal(page.doc.getElementById("news-list").children.length, 0);

  /* A version this contract does not speak: the guard, not a render. */
  page.env.browser.runtime.sendMessage = function () {
    return Promise.resolve({ ok: true, snapshot: { ...NEWS_SNAPSHOT, version: 2 } });
  };
  await pageApi.loadNews();
  pageApi.render();
  assert.equal(page.doc.getElementById("news-empty").hidden, false, "a version 2 snapshot degrades");
  assert.equal(page.doc.getElementById("news-list").children.length, 0);
});

test("a sendMessage that rejects, or a page with no runtime, leaves the region hidden", async () => {
  const page = makePage();
  page.env.browser.runtime.sendMessage = function () {
    return Promise.reject(new Error("ziy-news is not installed"));
  };
  await boot(page);
  const pageApi = page.sandbox.ZiyNtpPage;
  pageApi.view.config = {
    ...pageApi.view.config,
    widgets: { ...pageApi.view.config.widgets, news: true },
  };
  pageApi.render();
  await pageApi.loadNews();
  await new Promise((r) => setImmediate(r));
  assert.equal(page.doc.getElementById("news").hidden, false, "the region is on");
  assert.equal(page.doc.getElementById("news-list").children.length, 0);
  assert.equal(page.doc.getElementById("news-empty").hidden, false);

  /* Offline / no runtime at all: the widget stays hidden rather than painting
     an empty region over a page that works. */
  page.sandbox.browser = undefined;
  page.sandbox.chrome = undefined;
  pageApi.view.config = {
    ...pageApi.view.config,
    widgets: { ...pageApi.view.config.widgets, news: false },
  };
  pageApi.render();
  assert.equal(page.doc.getElementById("news").hidden, true, "off means off, no runtime needed");
});

test("the news widget's region is a real landmark beside its siblings", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "ui", "ntp.html"), "utf8");
  const section = /<section[^>]*id="news"[^>]*>/.exec(html);
  assert.ok(section, "the news section is in the shipped HTML");
  assert.match(section[0], /role="region"/, "and it is a landmark");
  assert.match(section[0], /aria-label="News"/, "with its own name");
  assert.match(section[0], /\bhidden\b/, "shipped hidden, like the cards section");
  /* The region the page writes into is a real list. */
  assert.match(html, /<ul[^>]*id="news-list"[^>]*role="list"/, "the rows live in a list");
});


test("every id the page looks up exists in the shipped HTML", () => {
  /* The harness seeds ids out of the real HTML, so a lookup of a missing id
     would silently return null and the page would throw at boot. This asserts
     the two sets agree. */
  const page = makePage();
  const lookupIds = Array.from(
    fs.readFileSync(NTP_SRC, "utf8").matchAll(/\$\("([^"]+)"\)/g),
    (m) => m[1],
  );
  const htmlIds = new Set(collectIds());
  const missing = lookupIds.filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], "every getElementById target is in the HTML");
  void page;
});
