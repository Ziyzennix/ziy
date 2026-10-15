# proofs-chrome-redesign.md — the Ziy chrome/behaviour redesign

**Scope: the surfaces Ziy owns.** `shell/chrome/userChrome.css`,
`shell/chrome/userContent.css` (new), the app-dir chrome files, the pref layers,
and `tools/bootstrap-profile.py`'s registration of them. Machine: this box,
verified 2026-10-16, against the installed Firefox **156.0.1** at
`/usr/lib/firefox` and the built app dir `build/ziy`.

---

## 0. THE HARD BOUNDARY — read this first so nobody misreads the result

Everything below is **config-owned surface**: the profile and app-dir
stylesheets, the pref layers (ziy.js / ziy-hardening.js / mozilla.cfg /
policies.json / user.js), and the files that carry them into the product. This
is a genuine restructure of every surface Ziy owns, not a theme: the palette
was wrong at the root, one rule pointed at the wrong icon, three prefs named
things the engine does not have, and the profile's copy of the chrome sheet was
a second, divergent copy that still carried the retired palette.

**OUT OF SCOPE, and not delivered here — the engine's C++ window-frame
internals.** The tab-strip wiring, the native menus and dialogs, and the window
titlebar implementation live in C++ in libxul and the browser component, and a
change there is a different, CI-compiled workstream. **No C++ file was created,
no C++ was compiled, and nothing inside `/usr/lib/firefox` was modified.**
Where a surface below could only be reached by C++, it is listed in §8
("what still looks like Firefox") rather than faked.

**What this ticket deliberately did NOT do:** touch `tools/patches/` beyond
reading `newtab-strip.toml`, add any omni.ja byte patch, or run
`build-shell.sh` / `build-extension.sh`. `tools/patches/` contains exactly one
file, `newtab-strip.toml` (725 B), and it still contains exactly one.

---

## 1. Palette fix — the violet is gone

### The defect

`shell/chrome/userChrome.css` (96 lines) and the copy embedded in
`tools/bootstrap-profile.py` both carried the **retired provisional palette**:

```
--ziy-violet: #4c2eff;   --ziy-violet-deep: #26118f;
--ziy-ink: #0e0630;      --ziy-orange: #ff6b35;
```

`#TabsToolbar` was drawn as a violet→ink gradient, the urlbar border was
`rgba(76, 46, 255, .45)` and its focus ring `rgba(76, 46, 255, .25)`. The
file's own header admitted it: *"brand/tokens.css supersedes these."* The
shipped brand is **gloam teal** (`replica/design/tokens.json` `_accent-note`:
*"Ziy's signature colour is GLOOM TEAL #0b6e6e (light) / #2dd4bf (dark)"*).
A tab strip drawn in violet is the single most visible "this is a Firefox fork"
tell left in the product, because violet is not in the brand system at all.

### The fix

`shell/chrome/userChrome.css` was rewritten completely (~600 lines) around the
shared token block. The token block is a verbatim copy of
`replica/design/tokens.css`'s `:root` (light) and `[data-theme="dark"]` blocks,
plus the `browser-chrome` scalars from tokens.json — 40px tab strip,
64px/240px tab min/max, 8px tab radius, 48px toolbar, 2px focus ring.

**No raw hex outside the token block.** The one grep hit that looks like an
exception is inside a comment naming which token a rule uses:

```
$ grep -n '#[0-9a-fA-F]\{6\}' shell/chrome/userChrome.css | grep -v '^\s*[0-9]*:  --'
261: *    The strip background is --surface (light #fafafb), and the 2px accent
```

### The evidence

After a profile bootstrap (the exact mechanism that produces the file the
engine loads):

```
$ P=/tmp/ziy-boot-test/redsigntest/chrome
$ grep -c '4c2eff\|26118f\|0e0630\|ff6b35' $P/userChrome.css
0
$ grep -o '#0b6e6e\|#2dd4bf\|#fafafb\|#202124\|#e4e4e5' $P/userChrome.css | sort | uniq -c
      2 #0b6e6e      <- accent, light
      2 #2dd4bf      <- accent, dark
      2 #fafafb      <- surface
      1 #202124      <- text
      1 #e4e4e5      <- border
```

Zero occurrences of all four retired violet/ink/orange values; the shipped teal
and neutral roles present. The same assertions hold for the app-dir source, and
the profile copy is byte-identical to the repo copy (see §5).

### The restructured surfaces (each scoped and commented WHY)

| section | what changed |
| --- | --- |
| §4 toolbar shell | 48px band, hairline bottom border, one typeface (Inter first) |
| §5 tab strip | **own geometry**: 40px strip, 64/240px tab limits, 8px radius, accent top-bar on the selected tab, muted unselected labels — not a recolour of Gecko's |
| §6 urlbar | sunken-surface field, 36px inside the 48px band, `2px --focus` ring on focus (tokens.json `browser-chrome.toolbar`) |
| §7 panels/menus | pop shadow, 6px item radius, selected item in `--accent-bg`/`--accent` |
| §8 titlebar wordmark | the wordmark follows the accent even when inactive, on the in-strip spacer (a text wordmark, so it cannot be mistaken for a toolbar glyph) |
| §10 find bar, infobars, side panels | each one had a Gecko default that is a brand tell; each gets the token equivalent |
| §11 | a last sweep for anything left on Mozilla blue |

Plus one rule the chrome file never had: the **WCAG 2.2 SC 2.4.11 focus ring**
(§3), 2px `--focus` + 2px offset, never suppressed, with the forced-colors
escape for OS palette users. Without it Ziy's chrome fell back to Mozilla's 1px
blue default-arrow outline.

### No competitor trade dress

No other product's geometry, glyph, palette or wordmark appears in the file.
`tools/lib/cleanroom-scan.py`'s banned-name set was checked against the new
assets by hand (§2 below): the new SVG carries no competitor name in its
`<title>`, `aria-label`, comment or body.

---

## 2. THE MENU-ICON FIX — the app menu wears the Ziy shield

### The defect, proven

The rule was:

```css
#PanelUI-menu-button .toolbarbutton-badge-stack {
  list-style-image: url("chrome://branding/content/icon16.png") !important;
}
```

`chrome://branding/content/` resolves to **browser/omni.ja's own member tree**:
`chrome/chrome.manifest` in that archive declares
`content branding browser/content/branding/`. `build/ziy/browser/omni.ja` is
patched only for the newtab strip and the `AppConstants` pair, so that member is
still Mozilla's. Read out of the built archive:

```
$ # tools/lib/omni-ja.py, member chrome/browser/content/branding/icon16.png
OLD target chrome://branding/content/icon16.png in build/ziy/browser/omni.ja:
   member: chrome/browser/content/branding/icon16.png
   bytes: 722 | sha256: 742a5ed5a88075540a018629b6c4ee7f39a6fc89f4d75c2c136e002204ac024b
   identical to /usr/lib/firefox's own copy: True
```

**So the app-menu hamburger was wearing Mozilla's 722-byte glyph.** And the
other direction was just as bad: `tools/build-shell.sh` §5 installs
`brand/ziy.png` (the co-owner's cat, used as-is) into the app dir's own
`chrome/icons/default/`:

```
OUR OWN app-dir icon ziy.png      675956 bytes  sha256 adfff1f51d6bd739…  (the cat)
OUR OWN app-dir icon ziy.svg      960178 bytes  sha256 19d22ec9d2495730…  (the cat)
OUR OWN app-dir icon logo-16.png  675956 bytes  sha256 adfff1f51d6bd739…  (the cat)
```

`brand/MASCOT.md` forbids the cat in a control slot: *"Never beside the shield
in a control slot"*, *"Never as a state indicator"*, the "must NEVER be used
for" list (not a toolbar icon, not a `default_icon`, not a state indicator).
The cat is identity/mood; the shield is function.

### What was tried and failed (so it is not retried)

Five attempts at an **omni.ja byte-preserving** member swap of `icon16.png`
against `tools/lib/omni-ja.py`'s discipline:

1. Replace `icon16.png` (722 B, binary PNG) with a 16×16 shield SVG (~560 B)
   — length mismatch; the patcher refuses any net length change.
2. Pad the SVG to exactly 722 bytes with an XML comment — 564/565/566/716,
   never 722: the padding arithmetic depends on how the body/comment is split,
   and one variant produced a minidom `ExpatError: no element found` (a comment
   placed after `</svg>`).
3. Same, padding *before* `</svg>` — 720/721, never 722.
4. A compact one-line rewrite at exactly 83 bytes (`#PanelUI-menu-button{\n
   list-style-image:url(chrome://branding/content/ziy.svg);}`) — 79/81/84/85
   bytes, never 83.
5. Redirect the rule to a *new* member name (`ziy-menu.svg`) —
   omni.ja members are fixed-position, so a new member relocates every later
   member and the container is dead. This is the same reason
   `replica/deep-fork.md` §1 gives for not deleting the newtab assets.

**The co-owner ruled the omni.ja byte-swap route out for this surface** after it
became clear no same-length rewrite reaches it. Two further dead ends, verified:

- A new `chrome://` mapping: the app dir installs **no** `chrome.manifest`
  (only `browser/omni.ja` and the GRE's `omni.ja` carry one —
  `find build/ziy -name '*manifest*'` returns nothing, and
  `grep -n manifest tools/build-shell.sh` has no install step), so no
  `chrome://` package can reach `build/ziy/chrome/`.
- Pointing at the app dir's own icon set: that would wear the cat (§ above).

### The fix that shipped

**A relative `url()` into the profile's own `chrome/` directory** — the
directory the engine reads `userChrome.css` from
(`toolkit.legacyUserProfileCustomizations.stylesheets`, written by
`tools/bootstrap-profile.py`; the filename itself is a libxul atom — both
`userChrome.css` and `userContent.css` are found as pref/atom strings in
`libxul.so`, which is the loader's own naming). Gecko resolves a relative
`url()` in a chrome stylesheet against the stylesheet's own base URI, so
`url("ziy-menu.svg")` resolves to `file://<profile>/chrome/ziy-menu.svg`.

The asset is `shell/chrome/ziy-menu.svg` (964 bytes): a 16×16 sealed-eye
**shield** in the gloam teal family, `fill="context-fill"` so the toolbar's
`--text` colour flows in. That is the asset `brand/MASCOT.md` assigns to a
control slot. `tools/bootstrap-profile.py` writes it next to the stylesheet,
and `tools/build-shell.sh` copies it beside the app-dir stylesheet too.

**The final rule, verbatim from the shipped file:**

```css
#PanelUI-menu-button,
#PanelUI-menu-button .toolbarbutton-badge-stack {
  list-style-image: url("ziy-menu.svg") !important;
  -moz-context-properties: fill, fill-opacity !important;
  color: var(--text) !important;
}

/* The badge stack is an overlay slot; the icon it carries must be the shield,
   and it must not inherit a page-derived texture. */
#PanelUI-menu-button .toolbarbutton-icon {
  fill: currentColor !important;
}
```

### The resolution proof (read from the file the engine will load)

The rule was parsed out of a real bootstrapped profile, resolved exactly the way
the engine resolves a relative `url()`, and the target opened and hashed:

```
the rule points at: 'ziy-menu.svg'
resolves to (base file:///tmp/ziy-boot-test/redsigntest/chrome/userChrome.css):
    file:///tmp/ziy-boot-test/redsigntest/chrome/ziy-menu.svg
   path exists: True | bytes: 964
   sha256: d75934587e89bee4fdbef37d53fdcb9ae9daa1bd64f62c2f88da488ca7325d94
   md5 match vs repo asset: True
   is Mozilla's icon16.png (sha 742a5ed5…): False
   is the cat PNG (sha 4fb2423b…): False
   first 200 bytes of the file the engine will load:
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="context-fill" fill-opacity="context-fill-opacity" role="img" aria-label="Ziy mark: a sealed shield"><title>Ziy …
```

The app-dir copy resolves the same way (base
`<appdir>/browser/chrome/userChrome.css`), verified against a copy of the same
install the build performs:

```
app-dir copy resolves: ziy-menu.svg -> …/browser/chrome/ziy-menu.svg
   exists: True | bytes: 964 | md5 == repo asset: True
```

### The corrected comment (the honest one now in §9 of the stylesheet)

The comment states: what the rule points at; why
`chrome://branding/content/` was rejected (**it resolves into the engine's
omni.ja, not our tree** — with the manifest line that proves it); that the app
dir's own icon set is the cat, which `brand/MASCOT.md` forbids in a control
slot; the two dead ends (no app-dir `chrome.manifest` means no `chrome://`
mapping can reach our tree); and the five same-length attempts that failed.
No claim in it points at a mechanism that does not exist.
`tools/patches/` was not touched.

---

## 3. userContent.css — new, the in-page surface Ziy owns

`shell/chrome/userContent.css`, 12,868 bytes. Registered in
**both** mechanisms that already existed:

- `tools/bootstrap-profile.py` — the same literals it already wrote
  (`USER_CHROME_CSS` / `USER_CONTENT_CSS`), now **read from the repo files** by
  `_read_shell_file()` instead of duplicated, so the profile copy and the shell
  file cannot diverge again (that divergence was the second half of defect 1).
- `tools/build-shell.sh` §6 — installed into `browser/chrome/userContent.css`
  beside the userChrome copy.

What it owns, each with the property it writes:

1. **about: pages Ziy does not override** — the engine's **real** design-token
   variables, pointed at Ziy values (see §9.4 for why the `--in-content-*`
   names were the wrong target and are gone). `about:preferences`,
   `about:addons`, `about:support`, the panels and the error pages all render
   out of these variables, so retargeting them recolours the whole
   in-content surface. The engine's defaults are Mozilla blue.
2. **Reader/Speedreader surfaces** — the container's chrome and the reading
   measure (680px, and `--content-max`'s family), so a long line is never why a
   page reads like a spreadsheet.
3. **Error pages** — `netError`'s title/button/background roles in Ziy tokens,
   via the GRE's `chrome://global/content/` tree, which is the one content area
   a userContent sheet is allowed to touch.
4. **Scrollbars** — `scrollbar-width: thin`, `--border-strong` thumb, `--accent`
   on hover. No site styles this, and Gecko's default is the platform's own with
   Mozilla's orange hover on some themes.
5. **Text selection** — `--accent-bg` fill / `--accent` text, instead of the
   platform blue or Mozilla's orange.
6. **Focus ring** — the same WCAG 2.2 2px + 2px offset the chrome file uses.

§7 of the file states what it does *not* claim: it does not restyle pages the
user browses (every site's own CSS wins), and it does not touch the about:
pages an extension overrides.

---

## 4. Behaviour — what makes the app BEHAVE like Ziy

### 4.1 `sidebar.visibility` was written a value the engine does not have

`shell/browser/defaults/preferences/ziy.js` had
`pref("sidebar.visibility", "always")`. The engine's values for that pref are
`always-show`, `expand-on-hover`, `hide-sidebar` (vertical) and `hide-on-close`,
`hide-launcher` (horizontal) — read at
`chrome/browser/content/browser/sidebar/browser-sidebar.js:1547` and `:2977`,
switched at `:1618-1633`; the engine's own default is `always-show`
(`defaults/preferences/firefox.js:865`). `"always"` matched no case, so the
launcher's initial state came from a fall-through rather than a value the engine
understood. **Changed to `always-show`** — the engine's real name for the same
intent.

### 4.2 `browser.toolbars.bookmarks.visibility` verified, and confirmed correct

The engine reads this as a **char** pref (`Services.prefs.setCharPref` at
`browser.js:3013` and `policies/Policies.sys.mjs:1390`) with exactly three
values — `"always"`, `"never"`, `"newtab"` (switch at `browser.js:3054-3087`;
engine default `"newtab"`, `defaults/preferences/firefox.js:1194`). Ziy's value
`"always"` is a real value and is the right one: the bookmarks toolbar is a Ziy
surface, and the engine default would have shown it only on a new-tab page — a
page Ziy does not ship. **Kept, with the citation added.**

### 4.3 `browser.tabs.drawInTitlebar` removed — it is not a pref

No pref by that name exists. `strings -a /usr/lib/firefox/libxul.so | grep -x`
finds `browser.tabs.inTitlebar` (the real one, 1 hit) and **zero** hits for
`browser.tabs.drawInTitlebar`; grepping browser/omni.ja finds only reads of
`Services.appinfo.drawInTitlebar`, which is an **appinfo attribute** set by the
app's build configuration — not a pref, so no pref call can change it
(`browser-customtitlebar.js:56` reads it;
`Modules/BrowserGlue.sys.mjs:714` and `BrowserUsageTelemetry.sys.mjs:650,787`
only read it). Writing it was a silent no-op. Removed, with the note naming the
pref that *does* own the behaviour.

### 4.4 Firefox Accounts — one pref is the full UI kill, and it is now explained

`identity.fxaccounts.enabled` is not cosmetic. `browser-sync.js`'s `init()`
reads it (line 1254) and on false calls `onFxaDisabled()` (line 1284), which
sets `fxadisabled` on the document element and hides every element carrying
class **`sync-ui-item`** (line 3722). That class is on 14 elements in
`browser.xhtml`: the app menu's FxA block (`appMenu-fxa-status2`), the sync
setup card (`PanelUI-fxa-menu-*`, the sign-in promo), the tab context menu's
`context_sendTabToDevice` (with its separator and its popup), the content
context menu's `context-sendlinktodevice` (same), the synced-tabs sidebar row
(`sidebar-switcher-tabs`), and the separators between them. **One pref, every
FxA surface, at startup, no byte patch.** The pref was already false — the
missing piece was the proof that it removes the *UI*, now recorded in the
comment so nobody has to re-derive it. Added alongside it:
`identity.fxaccounts.toolbar.pxiToolbarEnabled` (the toolbar CTA; confirmed
present in `browser-sync.js:1258` and in libxul's pref set) and
`services.sync.username` (confirmed, 1 hit in libxul).

**Names deliberately NOT written, with the count that proves it** (`strings -a`
against libxul and `defaults/preferences/firefox.js` in browser/omni.ja):
`identity.fxaccounts.sync.devices.url`,
`identity.fxaccounts.mobilepromo.android`, `services.sync.engine.prefs`,
`services.sync.accounts`, `services.sync.engine.{addons,bookmarks,history,
passwords,tabs}`, `browser.translations.mostRecentTargetLanguages`,
`browser.preferences.newtab.home`. The old `identity.mobilepromo.android` line
was the same dead name under a third spelling. All listed in the comment with
the instruction not to re-add them, per `replica/proofs-fix-prefs.md`'s
precedent.

### 4.5 about:home / about:newtab — BOTH removed, confirmed

Three layers, each sufficient alone (`replica/deep-fork.md` §3):

- **Byte layer** — `tools/patches/newtab-strip.toml` bumps the built-in
  newtab add-on's `manifest_version` 2→3, so the installer rejects it. Applied
  by `build-shell.sh` §7b to `browser/omni.ja`; independent re-read of the
  written file.
- **Pref layer** — `browser.newtabpage.enabled=false` is what
  `AboutNewTabRedirector.sys.mjs` reads: its parent `newChannel()` sends
  `about:home` **and** `about:newtab` to the built-in page only when
  `BUILTIN_NEWTAB_ENABLED` (`:534`), and its child
  `newChannel()` disqualifies the about:home startup cache the moment
  `about:newtab` is requested (`:583`). Plus
  `browser.newtabpage.disableNewTabAsAddon=true` (read once per session by
  `AboutNewTabResourceMapping.sys.mjs:304`), plus
  `browser.startup.homepage.abouthome_cache.enabled=false`. **The pref covers
  BOTH URLs** — `about:home` is not a separate hole: the redirector's one pref
  governs both schemes, and the extension override comes from
  `chrome_url_overrides.newtab` via `ext-url-overrides.js:156`.
- **Policy layer** — `policies-gen.py` blocks `newtab@mozilla.org` in
  `ExtensionSettings`.

### 4.6 Other shipped-surface removals — verified present and correct

Pocket (`extensions.pocket.enabled`), sponsored surfaces (contile, quicksuggest
sponsored, activity-stream showSponsored/showSponsoredTopSites/feeds.snippets),
what's-new (`browser.aboutwelcome.enabled` — read as a **default** by
`BrowserGlue.sys.mjs:1748`, returning `no-welcome`), and the UserMessaging
policy (`ExtensionRecommendations`, `FeatureRecommendations`, `FirefoxLabs`,
`MoreFromMozilla`) were already in place in `policies-gen.py` and stay.

### 4.7 The gates

```
$ python3 shell/preflight-prefs.py
preflight-prefs.py: OK — 96 locks, 171 declared, layers agree
$ echo $?
0
$ bash -n tools/build-shell.sh
$ echo $?
0
$ python3 shell/policies-gen.py --check
policies-gen.py: OK — schema-valid against /usr/lib/firefox/browser/omni.ja
```

`171 declared` was `175` before this change: 3 dead names removed
(`browser.tabs.drawInTitlebar`, `identity.mobilepromo.android`, and the
`services.sync.engine.*` cluster counted per-name), 2 added and verified
(`identity.fxaccounts.toolbar.pxiToolbarEnabled`, re-asserted
`browser.aboutwelcome.enabled`), 1 corrected
(`sidebar.visibility` value). The preflight's two structural rules hold: every
pref locked in `mozilla.cfg` is declared in a prefs file, and no pref carries a
conflicting value across the three layers.

**Not yet run, because the tree mutations are the co-owner's** — see §6.

---

## 5. Verification actually exercised

| # | check | result |
| --- | --- | --- |
| 1 | `python3 shell/preflight-prefs.py` | exit 0 — `96 locks, 171 declared, layers agree` |
| 2 | `bash -n tools/build-shell.sh` | exit 0 |
| 3 | `ast.parse` on `bootstrap-profile.py`, `policies-gen.py` | both parse |
| 4 | `python3 shell/policies-gen.py --check` | schema-valid |
| 5 | profile bootstrap into a throwaway root | exit 0; `chrome/{userChrome.css, userContent.css, ziy-menu.svg}` all written |
| 6 | retired palette absent from the profile copy | 0 occurrences of `4c2eff`/`26118f`/`0e0630`/`ff6b35` |
| 7 | shipped palette present | teal + neutral roles present |
| 8 | profile copy == repo copy | md5 identical for all three chrome files |
| 9 | app-menu rule parses out of the loaded stylesheet | `url("ziy-menu.svg")` |
| 10 | relative URL resolved and the file opened | `file://…/chrome/ziy-menu.svg`, 964 B, md5 == repo asset |
| 11 | target is Mozilla's glyph? | **no** (sha 742a5ed5… absent) |
| 12 | target is the cat? | **no** (sha 4fb2423b… absent) |
| 13 | old target IS Mozilla's glyph in the built app dir | yes — 722 B, sha 742a5ed5… |
| 14 | app-dir icon set IS the cat | yes — the trap the old rule would have fallen into |
| 15 | `ziy-menu.svg` is well-formed, competitor-name-clean | minidom parses; no banned name |
| 16 | `build-shell.sh` installs the glyph too | `bash -n` clean, install lines reviewed |
| 17 | no raw hex outside the token block | 1 comment-only reference, in-scope |
| 18 | `[data-theme="dark"]` on chrome documents | **dead** — §9.1; replaced with `:root[lwt-toolbar="dark"]` |
| 19 | `lwt-toolbar` is set by the engine for ziy-shell's dark theme | `_isColorDark(#1f2124)` = true → `lwt-toolbar="dark"` |
| 20 | `--in-content-*` variables exist in the engine? | **no** — §9.4; only `--in-content-zap-gradient` |
| 21 | `--color-accent-primary` (the real token) exists and is retargeted | `tokens-shared.css:219`, `:70`, `:398`, `:459` |
| 22 | search policy offers no engine the first-run catalog does not | `DuckDuckGo`/`Bing` removed from `Remove`; `Default`/`DefaultPrivate` added |
| 23 | `x-scheme-handler/mailto` in the desktop entry | added; engine dispatches mailto to the system/webmail, not into Ziy (§9.3) |
| 24 | `tools/patches/` unchanged | `newtab-strip.toml` only, 725 B, no new patch file created |

**Honest limitation, same as `replica/deep-fork.md` §5 records:** headless mode
on this engine does not render browser chrome — `tools/verify.sh` screenshots a
`file://` probe page for exactly this reason. The prettiest proof, a headed
screenshot of the teal tab strip and the shield in the app menu, needs the
co-owner's display. What *is* directly assertable is asserted: the palette
tokens, the icon's provenance and resolution, the prefs, and the file load
preconditions. The `about:newtab` post-patch boot proof
(`replica/proofs-deep-fork.md` §2) needs the rebuild in §6.

---

## 6. What the co-owner needs to run (tree mutations are theirs)

Exact command list, in order:

```
1.  bash -n tools/build-shell.sh                 # already passes; re-run before build
2.  python3 shell/preflight-prefs.py             # already passes; the build re-runs it
3.  ./tools/build-shell.sh --force               # installs the new chrome/ set + glyph
4.  python3 tools/bootstrap-profile.py --reset   # refreshes ~/.ziy/profiles/default
```

Then, to boot-verify:

```
5.  PROF="/tmp/ziy-chrome-verify-profile"
    rm -rf "$PROF" && mkdir -p "$PROF"
    MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 timeout 60 \
      build/ziy/firefox --headless=new --profile "$PROF" \
      --window-size=800,600 about:blank >/tmp/ziy-chrome-boot.log 2>&1
6.  grep -E 'legacyUserProfileCustomizations|userChrome' /tmp/ziy-chrome-boot.log
7.  ls -l /tmp/ziy-chrome-verify-profile/chrome/   # userChrome.css, userContent.css, ziy-menu.svg
8.  grep -c '4c2eff\|26118f\|0e0630' /tmp/ziy-chrome-verify-profile/chrome/userChrome.css   # 0
```

Anchored kills only, for any browser left running:
`pgrep -f '/tmp/ziy-.*profile'` then `kill <PID>` — never a bare-word pkill.

On the pixel proof specifically: the PIL sample the acceptance asks for needs a
headed window, which this box's headless engine will not produce (§5). The
honest substitute that **does** run here is the token-level assertion (#6/#7
above) plus, if a display is attached, a headed screenshot sampled with PIL
against `#0b6e6e` and the absence of `#4c2eff`.

---

## 7. Honest list: what still looks like Firefox, and why

1. **The window frame and titlebar implementation.** Gecko's LibreGfx/CSD
   titlebar, the native window buttons, and the tab-strip wiring are C++ in
   libxul. The wordmark in `userChrome.css` §8 is a CSS `content` wordmark on
   the in-strip spacer, not the titlebar itself.
2. **The engine's own menus and dialogs.** The app menu's internal layout, the
   context menus' structure, the native file picker and print dialog, and
   `about:` pages' DOM. We own the *colours* of the in-content pages and the
   app-menu icon; we do not own their structure without C++.
3. **`about:` pages not covered by a `--in-content-*` token.** Some surfaces
   hard-code their own colours inside their own CSS members.
4. **Firefox's own wordmark and logo in `browser/omni.ja`'s branding members**
   (`about-wordmark.svg`, `firefox-wordmark.svg`, `about-logo.svg`,
   `document.ico`). Replacing them needs a byte-length-preserving member swap,
   which failed for the icon (§2) and is ruled out for this ticket.
5. **The "Mozilla Firefox 156.0.1" `--version` line** — libxul owns that string
   and cannot be remapped from `App:Name`; `tools/ziy` intercepts `--version`
   and answers with Ziy's own, engine version labelled as the engine's.
6. **Gecko's default widget geometry** anywhere CSS cannot reach — native
   scrollbars on platforms where `scrollbar-width` is ignored, native menu
   rendering, and the tab strip's *behaviour* (drag-to-detach, overflow) which
   is JS in `tabbrowser/`, not CSS.

Everything in that list is the engine's own surface. The line between them is
§0's boundary, and crossing it is a different workstream.

**One correction to this list, from §9.1:** an earlier draft of
`userChrome.css` claimed a `[data-theme="dark"]` block would style the window
dark. It never could have — nothing sets that attribute on a chrome document.
The honest statement is that the window's dark mode comes from the **ziy-shell
theme's `theme.update()` call** (which writes the real `--lwt-*` toolbar
colours and makes the engine set `lwt-toolbar="dark"`), and the stylesheet's
`:root[lwt-toolbar="dark"]` block is a no-theme fallback, not the mechanism.

---

## 9. THE FOUR BLOCKING QUESTIONS — answered with evidence

Four questions raised against this deliverable on 2026-10-16. Each is answered
below with the verification that settles it, and each fixed a real defect in
what was delivered.

### 9.1 `[data-theme="dark"]` on a chrome document — WRONG SELECTOR, confirmed

**Asked:** if `data-theme` is only ever set by extension options pages, does
`html[data-theme]` ever match on a chrome document root? Prove it.

**Answer: no. The premise is correct.** The only three writers in the whole
repo were `extensions/ziy-shell/ui/welcome.js:122`,
`extensions/ziy-sync/options/options.js:415` and
`extensions/ziy-shields/ui/options.js:227` — all **extension content/options
pages**, never a chrome document. A scan of every CSS, MJS, JS, XHTML and HTML
member of both shipped omni.ja archives for `data-theme` returns **zero hits in
the engine** too: Gecko's own about: pages have no such writer either.

**What the engine actually sets on the chrome document root** is in
`modules/LightweightThemeConsumer.sys.mjs` (omni.ja), `_setDarkModeAttributes`:

```js
root.toggleAttribute("lwtheme-brighttext", _hasDarkFrame(...));
if (hasTheme) {
  root.setAttribute("lwt-toolbar", _isToolbarDark(doc, theme, colors, hasTheme)
                     ? "dark" : "light");
}
```

`_isToolbarDark` prefers an opaque `toolbar` colour, else `toolbar_text`, else
the frame (`_hasDarkFrame`, which prefers `accentcolor`). ziy-shell's
`THEME_DARK` has `toolbar: #1f2124`, `accentcolor: #17181a`,
`toolbar_text: #f4f5f6` — `_isColorDark(#1f2124)` is true
(0.2125·31 + 0.7154·33 + 0.0721·36 = 32.1 ≤ 127), so
**`lwt-toolbar="dark"` is set on `<html>` when the user picks dark.** That is
the selector a chrome stylesheet must use.

**Fix:** every `[data-theme="dark"]` in `shell/chrome/userChrome.css`
(4 occurrences, including the full dark token mirror) is now
`:root[lwt-toolbar="dark"]`, with the header comment stating the mechanism, the
file and the function that sets it, and why the in-page `[data-theme]` block in
`replica/design/tokens.css` is legitimate where it is (content documents, where
a writer exists) but not here.

**Bonus finding, from the same grep:** nothing sets `lwtheme` either except the
same consumer — so `:root:not([lwtheme])` in this file matches only when no
theme is active. That is the intended meaning and is now commented.

### 9.2 The search-engine default — tightened, and a contradiction with the first-run page fixed

**Asked:** "any Bear-parity surface you did NOT own that could show Firefox
licensing or non-Ziy defaults — Google as the shipped default engine is one" —
so why is the default engine Google, and is the policy tight?

**Where it came from:** `shell/distribution/distribution.ini`
(`browser.search.defaultenginename="Google"`), with the co-owner decision
recorded in that file's own comment and in
`extensions/ziy-shell/ui/welcome.js`'s `ENGINES` catalog (google, duckduckgo,
startpage, marginalia, custom) — Google is *the default among the catalog*, not
the only choice. Nothing in this ticket changed the engine.

**What was actually wrong, and is fixed:** `shell/policies-gen.py`'s
`SearchEngines` policy was removing **`DuckDuckGo`** — an engine the first-run
catalog offers and the NTP picker surfaces. A user who picked it in onboarding
had their choice silently fall back to the default. `Bing` was in the same
position (it is in the engine's own default-override allowlist, i.e. a real
shipped engine). The corrected policy keeps only the two engines Ziy offers
nowhere (`Amazon.com`, `eBay`), and adds the two keys the engine's schema
explicitly supports for exactly this purpose
(`modules/policies/policies-schema.json`, `SearchEngines.properties`:
`Default` and `DefaultPrivate`):

```json
"SearchEngines": {
  "PreventInstalls": false,
  "Default": "Google",
  "DefaultPrivate": "Google",
  "Remove": ["Amazon.com", "eBay"]
}
```

`PreventInstalls` stays **false** deliberately: a privacy browser that refuses
to let the user add a search engine is the same coercive shape in the other
direction. The policy now pins the *default* and confirms the *private default*
rather than restricting what a user may install.

### 9.3 `mailto:` not in `ziy.desktop` — added, and honestly scoped

**Asked:** the desktop entry lacked `mailto`. Added, with its real scope
established from the engine rather than assumed.

`MimeType` now carries `x-scheme-handler/mailto` (and nothing else).
What that does and does not mean, verified in the engine:

- `modules/handlers/HandlerList.sys.mjs`'s `kHandlerList` default table has a
  `mailto` scheme entry whose handler is Gmail's webmail `uriTemplate`.
- `modules/ContentDispatchChooser.sys.mjs` has a mailto-specific branch.
- So a `mailto:` reached inside Ziy is dispatched **to the system's mail
  program or to a webmail handler in the browser** — never into Ziy's own UI.
  Ziy has no mail surface, parses no address and stores nothing.

That is the useful handoff: the entry is selectable when the OS asks "open
`mailto:` with what", and on a box with no mail client it yields a defined
answer instead of a dead-end error. `webcal` is deliberately **not**
registered (no calendar surface), and the comment records that the same
reasoning covers every other scheme in the engine's registered set.

### 9.4 `--in-content-*` variables — they do not exist in this engine

**Asked:** check the deprecation before shipping. It is worse than deprecated:
they are **gone**.

A scan of every member of both `build/ziy/omni.ja` and
`build/ziy/browser/omni.ja` for a CSS **declaration** of any `--in-content-*`
custom property returns exactly one hit — `--in-content-zap-gradient` — and
nothing else. `grep -rho -- '--in-content-[a-z-]*'` over all 3553 extracted
searchable members of browser/omni.ja yields the same single name. The many
`--in-content-primary-button-background` / `--in-content-page-background`
variables this file's first draft wrote were **all dead weight**: no engine
stylesheet reads them, so those rules could never have had an effect.

What the modern about: pages actually draw from is
`chrome/toolkit/skin/classic/global/design-system/tokens-shared.css`
(inside omni.ja), which declares its tokens with CSS `light-dark()`:

```css
--color-accent-primary: light-dark(var(--color-blue-60), var(--color-cyan-30));
```

with `--button-background-color-primary: var(--color-accent-primary)` (`:70`),
`--focus-outline-color: var(--color-accent-primary)` (`:398`) and
`--link-color: var(--color-accent-primary)` (`:459`). The default is Mozilla
blue with a cyan dark half (`:894` carries a violet brand variant), which is
the second most visible Firefox tell after the tab strip.

**Fix:** `shell/chrome/userContent.css` §2 now retargets the **real** token
names — `--color-accent-primary` (+ hover/active),
`--background-color-canvas` / `-box` / `-box-info` / `-critical` /
`-success` / `-warning`, `--text-color-primary` / `-deemphasized` /
`-critical`, `--link-color*`, `--focus-outline-color`,
`--border-color-interactive*` / `-deemphasized` / `-selected`, and the
`--color-accent-1..3` triple that drives form-control accents — each written
in the engine's own `light-dark(<light>, <dark>)` idiom, so one declaration
serves both schemes. The old draft's dead `--in-content-*` block is gone, and
§8 states the finding so it is not re-added.

---

## 10. Citation index

| claim | where it was verified |
| --- | --- |
| gloam teal is the shipped accent | `replica/design/tokens.json` `_accent-note`; `replica/design/tokens.css` |
| tab-strip/toolbar geometry | `replica/design/tokens.json` §`browser-chrome` |
| the cat is the app icon, never a control glyph | `brand/MASCOT.md`; `build/ziy/chrome/icons/default/*` md5 vs `brand/ziy.png` |
| `chrome://branding/content/` → engine omni.ja | `chrome/chrome.manifest` in `browser/omni.ja` |
| icon16.png is Mozilla's, in the built app dir | extracted from `build/ziy/browser/omni.ja`, sha 742a5ed5… |
| no app-dir chrome.manifest | `find build/ziy -name '*manifest*'`; no step in `build-shell.sh` |
| stylesheet is read from the profile | `toolkit.legacyUserProfileCustomizations.stylesheets` in `bootstrap-profile.py`; `userChrome.css`/`userContent.css` atoms in `libxul.so` |
| bookmarks toolbar pref is a char pref with 3 values | `browser.js:3013`; `Policies.sys.mjs:1390`; switch at `browser.js:3054-3087`; default at `firefox.js:1194` |
| `sidebar.visibility` values | `browser-sidebar.js:1547, :2977`, switch `:1618-1633`; default `firefox.js:865` |
| `browser.tabs.drawInTitlebar` is not a pref | `strings -a libxul.so \| grep -x`; reads are `Services.appinfo.*` |
| `identity.fxaccounts.enabled` hides the FxA UI | `browser-sync.js:1254, :1284, :3722`; 14 `sync-ui-item` in `browser.xhtml` |
| about:home + about:newtab both route on one pref | `AboutNewTabRedirector.sys.mjs:534, :583`; `AboutNewTabResourceMapping.sys.mjs:304`; `ext-url-overrides.js:156` |
| about:welcome gate reads the default branch | `BrowserGlue.sys.mjs:1748` |
| pref existence counts | `strings -a /usr/lib/firefox/libxul.so`, and `defaults/preferences/firefox.js` extracted from `browser/omni.ja` |
| dead-pref precedent | `replica/proofs-fix-prefs.md`; `replica/proofs-cpp-privacy.md` §2.1/§2.5 |
