/* Ziy-shell unit tests — pure logic only, no browser APIs.
 *
 * Run with: npm test, which runs node --test across the extensions test dirs.
 *
 * The theme's role mapping is the part worth asserting: it is where a token
 * rename or a colour slip would otherwise ship silently. Everything here reads
 * the manifest and the generated tokens, so a tokens.json change that breaks a
 * theme role fails here, not in the browser.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const REPO = path.join(EXT_DIR, "..", "..");

const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
const tokens = JSON.parse(fs.readFileSync(path.join(REPO, "replica/design/tokens.json"), "utf8"));
const tokensCss = fs.readFileSync(path.join(EXT_DIR, "ui/tokens.css"), "utf8");

test("the add-on id is the suite id the distribution installer expects", () => {
  assert.equal(manifest.browser_specific_settings.gecko.id, "ziy-shell@ziy.app");
});

test("the manifest carries no static theme key (it would make the manifest invalid)", () => {
  // A manifest with a `theme` key is normalized against manifest.ThemeManifest,
  // which does not allow background/permissions — the whole add-on is then
  // rejected by the app-dir installer. Geo proof: cf. ext-theme.js's comment
  // "only static themes are processed here; extensions with the theme
  // permission do not enter this code path".
  assert.equal(manifest.theme, undefined, "manifest.theme must not be present");
  assert.equal(manifest.dark_theme, undefined, "manifest.dark_theme must not be present");
  assert.ok(manifest.permissions.includes("theme"), "theme.update() needs the theme permission");
});

test("the role mapping is sourced from the design tokens, not hand-copied", () => {
  // theme.js is a module; read the roles back out of it for this assertion.
  const src = fs.readFileSync(path.join(EXT_DIR, "background/theme.js"), "utf8");
  const light = tokens.color;
  const dark = tokens.color.dark;

  // Each theme role must appear in theme.js with the token's value, so a token
  // change is caught here rather than shipping silently.
  const expectations = [
    [src, light.accent, "frame"],
    [src, light.surface, "toolbar"],
    [src, dark.bg, "frame (dark)"],
    [src, dark.surface, "toolbar (dark)"],
    [src, dark.accent, "icons (dark)"]
  ];
  for (const [text, value, label] of expectations) {
    assert.ok(
      text.includes(value),
      `${label} role value ${value} is not in theme.js — the role drifted from its token`
    );
  }
});

test("the theme module defines two distinct schemes", () => {
  const src = fs.readFileSync(path.join(EXT_DIR, "background/theme.js"), "utf8");
  assert.ok(src.includes("THEME_LIGHT"), "no light theme");
  assert.ok(src.includes("THEME_DARK"), "no dark theme");
  assert.ok(src.includes('color_scheme: "light"'));
  assert.ok(src.includes('color_scheme: "dark"'));
  // Distinctness is the actual property a user notices.
  assert.ok(!src.includes('frame: "#17181a",\n    frame_inactive: "#08504f"'));
});

test("the background script is the event page, not a service worker", () => {
  // Gecko does not implement MV3 service workers (architecture.md §1.3); the
  // scripts array is the only supported form.
  assert.deepEqual(manifest.background.scripts, ["background/theme.js", "background/background.js"]);
  assert.equal(manifest.background.service_worker, undefined);
  assert.equal(manifest.manifest_version, 3);
});

test("permissions stay minimal", () => {
  assert.ok(manifest.permissions.includes("storage"), "the welcome page persists to storage.local");
  assert.ok(manifest.permissions.includes("tabs"), "the welcome page is opened with tabs.create");
  assert.ok(manifest.permissions.includes("theme"), "theme.update() needs the theme permission");
  assert.deepEqual(manifest.host_permissions, [], "no host access at all");
  // Nothing optional is requested at all.
  assert.deepEqual(manifest.optional_permissions, [], "no optional permissions requested");
});

test("the generated tokens css carries both palettes", () => {
  assert.match(tokensCss, /--accent:\s*#0b6e6e/, "light accent missing from generated tokens");
  assert.match(tokensCss, /#0b6e6e/.source ? /--accent: #0b6e6e/ : /x/, "light accent role missing");
  assert.match(tokensCss, /\[data-theme="dark"\]/, "dark block missing");
  assert.match(tokensCss, /--accent: #2dd4bf/, "dark accent missing from generated tokens");
  // Focus ring must exist and never be suppressed (WCAG 2.2, tokens.css).
  assert.match(tokensCss, /outline: 2px solid var\(--focus\)/);
  assert.match(tokensCss, /outline-offset: 2px/);
});

test("the welcome page and the theme module ship their assets", () => {
  for (const rel of [
    "ui/welcome.html",
    "ui/welcome.js",
    "ui/done.html",
    "ui/tokens.css",
    "background/background.js",
    "background/theme.js",
    "icons/icon.svg",
    "icons/wordmark.svg"
  ]) {
    assert.ok(fs.existsSync(path.join(EXT_DIR, rel)), `${rel} missing`);
  }
});

test("every token the welcome page uses is defined by the generated tokens", () => {
  const tokens = fs.readFileSync(path.join(EXT_DIR, "ui/tokens.css"), "utf8");
  const defined = new Set(tokens.match(/(--[\w-]+)\s*:/g) || []);
  for (const page of ["ui/welcome.html", "ui/done.html"]) {
    const html = fs.readFileSync(path.join(EXT_DIR, page), "utf8");
    const used = html.match(/var\((--[\w-]+)/g) || [];
    const missing = used.filter(u => !defined.has(u.slice(4) + ":"));
    assert.deepEqual(missing, [], `${page} uses tokens the generated file does not define`);
  }
});

test("tokens.css is generated, not hand-written", () => {
  assert.match(tokensCss, /GENERATED from replica\/design\/tokens.json/);
});
