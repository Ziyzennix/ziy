# Deploying Ziy

How a user goes from this repo to a running browser, what is verified, and what
is not. Every command below was run on this machine; the captured output is in
`replica/proofs-desktop.md`.

Ziy is a browser product built on Mozilla's Gecko engine. It is a clean-room
product: it ships its own application directory, its own branding, its own
WebExtension suite, and its own profile tree. It never modifies the Firefox
install it is built from, and it never touches `~/.mozilla` except to register a
native-messaging manifest for its sync agent.

---

## 1. From the repo to a running browser

```bash
git clone <repo> ziy && cd ziy
npm ci                       # installs the extension suite's workspace deps
npm test                     # optional but recommended: the whole node suite
./tools/build-shell.sh       # -> build/ziy/  (app dir + omni.ja patch + icons + prefs)
./tools/build-extension.sh --all   # -> build/ziy/distribution/extensions/*.xpi
./tools/install-native.sh    # writes the sync agent's manifest (asks first)
./tools/bootstrap-profile.py # -> ~/.ziy/profiles/default/
./tools/install-desktop.sh   # .desktop entry + hicolor icons into ~/.local
./tools/ziy                  # launch
```

`./tools/ziy` is the only command that starts the product. Everything before it
is packaging.

### What each step does

| step | what it produces | notes |
| --- | --- | --- |
| `npm ci` | `node_modules/` for the extension suite | the suite has no runtime dependencies; these are the test toolchain |
| `npm test` | nothing | `node --test extensions/*/test` — 573 assertions across the suite |
| `build-shell.sh` | `build/ziy/` | copies the engine tree, rewrites `application.ini` for Ziy, patches `omni.ja` so our unsigned suite installs, runs the preflight on the pref layers |
| `build-extension.sh --all` | one `.xpi` per extension | deterministic packaging: the same tree gives the same bytes |
| `install-native.sh` | `~/.mozilla/native-messaging-hosts/ziy-sync-agent.json` | writes a **registration of an executable**, not Ziy's state |
| `bootstrap-profile.py` | `~/.ziy/profiles/default/` | the profile the product owns: `user.js`, `userChrome.css`, the autoconfig marker |
| `install-desktop.sh` | `~/.local/share/applications/ziy.desktop` + `~/.local/share/icons/hicolor/*/apps/ziy.png` | idempotent; prints what it did and what it could not |

### The launcher

```bash
./tools/ziy                          # boot the default profile
./tools/ziy --profile work           # boot ~/.ziy/profiles/work
./tools/ziy --headless -H            # headless, for scripts and CI
./tools/ziy --ziy-version            # Ziy branding + the engine version, labelled
./tools/ziy --help                   # the launcher's own help, in Ziy's voice
./tools/ziy https://example.com      # every other argument passes through
```

The launcher resolves the app dir from its own location, so it works from any
cwd. It creates a missing profile with `bootstrap-profile.py` on demand, so a
first run on a fresh box works without a manual step. It never runs an
installer for you.

---

## 2. Verifying the install

```bash
./tools/verify.sh
# or, equivalently
npm run verify
```

One line per check — `PASS`, `FAIL` or `SKIP` with the evidence — and a summary.
Non-zero exit on any `FAIL`. The sections:

1. `build/ziy` exists, and its `omni.ja` carries `MOZ_REQUIRE_SIGNING: false`
2. the app boots headless and renders a non-blank screenshot
3. `--version` identity
4. our prefs land in `prefs.js` after a real boot
5. the suite directory is wired
6. the signing bypass actually installs an unsigned add-on
7. **the full-suite gate**: every id in `shell/extensions.list` is built as
   `<id>.xpi`, installed *and* active in `extensions.json`, and carries an
   `installedDistroAddon` marker, after a real boot
8. feature-level headless checks (shields, NTP, news, playlist, talk, sync,
   desktop, the whole node suite)
9. the pref/lock layer (preflight + `mozilla.cfg`)
10. the native helpers
11. the desktop integration files
12. the clean-room guard (`tools/lib/cleanroom-scan.py`)

Section 7 is the one that matters most: it is the assertion that the product a
user gets has the whole suite, not a dev subset.

---

## 3. What is verified

Everything asserted by a `PASS` line in `./tools/verify.sh`, on this machine,
against Firefox 156.0.1. The last full run:

```
$ ./tools/verify.sh ; echo "exit=$?"
...
  48 passed, 0 failed, 2 skipped
exit=0
```

**2026-10-16 — the number above was re-measured and replaced.** The earlier
`46 passed, 0 failed, 1 skipped` baseline and the `45 passed, 0 failed, 2
skipped` live run in this section were stale; the run recorded here was taken
after `./tools/build-shell.sh --force` and `./tools/build-extension.sh --all`
rebuilt the app dir with the redesigned chrome set, so it is the first gate run
on the settled tree. Both SKIPs are engine limitations, not gaps in the product:
`--version does not say Ziy` (libxul owns the version string, so
`tools/ziy --ziy-version` answers with Ziy's own branding plus the engine
version clearly labelled) and the playlist-panel probe (headless will not render
the panel; the suite it probes is unit-passing). `replica/HANDOFF.md` §3 carries
the same figures.

One line per check, `PASS`/`FAIL`/`SKIP` plus the evidence, and a non-zero exit
on any `FAIL`.

The proofs live in `replica/proofs/` and `replica/proofs-*.md`. The desktop
slice's own proof, with every command and its observed output, is
`replica/proofs-desktop.md`.

In particular, these are *observed*, not inferred:

- the app dir boots as an independent product (`ps` shows `-appDir <ziy>/browser`
  with our own binary and GRE paths)
- our suite installs unsigned, and every id is active in `extensions.json`
- the prefs the shell locks are in `prefs.js` after a real boot
- the Shields blocking engines stop real trackers, in both the DNR and the
  `webRequest` tier
- the sync chain transfers a record between two real throwaway profiles, and the
  server's own database holds no plaintext
- the NTP renders its real bundle, and the news region renders real rows from
  real parsed fixtures
- the HTML and Chromium-JSON bookmark parsers read real export files, and the
  export round-trips
- the desktop entry installs, and the hicolor icons match their slot sizes

---

## 4. Known limitations

Consolidated from every `proofs-*.md` honest-limitations section. Ordered by how
likely a user is to notice.

### Engine limits that cannot be worked around

| limitation | why | what Ziy does instead |
| --- | --- | --- |
| **`--version` says "Mozilla Firefox"** | the engine's `--version` string comes from `libxul`, and does not remap from `App:Name` in `application.ini` | identity is proven by the app-dir boot, the `distribution.iniFile` markers, `about:policies`, the branded screenshot, and `tools/ziy --ziy-version` |
| **a private window cannot be created by an extension** | `windows.create`'s `CreateType` enum is `normal, popup, panel, detached_panel` — there is no private flag on this engine | the menu names the engine's own path (`Ctrl+Shift+P`), rather than shipping a button that would not work |
| **`Ctrl+Plus` / `Ctrl+Minus` / `Ctrl+0` are not valid extension shortcuts** | the engine's own `ShortcutUtils.validate` accepts only `A–Z0–9`, the named punctuation keys and `F1–F12` | the zoom commands ship with no suggested key; they work from the menu and from the shortcut editor, and `Ctrl+0`-shaped keys are absent from the reserved-key list so the advisory stays true |
| **no extension can be the default browser** | no default-browser API exists in any schema in this engine | the menu *reads* the state from a helper and shows the command; it never claims a state it did not read |
| **no extension can switch profiles** | the mechanism is the launcher's `--profile` | the menu copies `tools/ziy --profile <name>` instead of pretending to switch |
| **`about:newtab` / `moz-extension://` cannot be screenshotted or navigated to remotely** | this build's WebDriver BiDi refuses both with `unsupported operation` | the NTP is proven by rendering its real bundle from the shipped files; the `chrome_url_overrides` routing itself is asserted by the suite gate, not by a pixel |
| **per-site fingerprint sub-toggles cannot reach the pref at runtime** | no extension API on this engine writes a preference | the value is built and unit-tested as JSON; the shell's autoconfig/policies layer owns the write |
| **`privacy.resistFingerprinting` cannot be locked by policy** | the policy `Preferences` `allowedPrefixes` list does not include it | it is locked in `mozilla.cfg` instead |
| **HLS live manifests, DASH, DRM'd media do not play** | this engine has no live-stream resolution, no DASH pipeline, and no CDN access for signed content | the Playlist marks such items as page items that open in a tab |
| **background playback is unavailable** | a sidebar document is unloaded when the sidebar closes; an extension has no browser-side media process | playback pauses with its place kept, and the panel says so |

### Verified-in-part, and where the gap is

Each of these has a real implementation and a real proof; the missing piece is
an environment this machine does not have (a display, a Jitsi server, a
`moz-extension` origin, a live network fetch from inside the browser).

- **the theme is applied to chrome only when a window exists** — headless has no
  chrome to paint, so the applied theme is not visually confirmed headless
- **the suite's own event pages were not driven live over BiDi** — the panel
  proofs use the shipped `lib/` files and the same contracts, through the route
  this build allows
- **a live multi-party call was not proven** — that needs a deployed Jitsi server
- **the sync rotating word has no live network source** — the fallback path ran
- **TLS was not exercised on the sync path** — the e2e runs over loopback with
  an explicit opt-in; cert pinning is documented, not implemented
- **the `find` bar is the engine's** — `browser.find` exists and is used for the
  programmatic search; the full find bar remains the engine's own

### Deliberate product decisions, not gaps

- no ads, no rewards economy, no crypto wallet, no VPN, no hosted AI assistant —
  all cut by product decision, recorded as `cut` in `replica/features.csv`
- Widevine and the Guardian backbone are `skip`: neither is something Ziy will
  operate

---

## 5. LAUNCH BLOCKERS — what must land before a public release

**Nothing here is a test; this is the list a release is gated on.** It is kept
here, beside the verify sections, so the gate is read with the thing it gates.
Status recorded 2026-10-15, updated 2026-10-16 (batch pass); every row cites the file that establishes it.

**0 — The model, for context (not a blocker).** Ziy ships **free** — no paid
tier, no feature gating, no accounts, no DRM — with a single Ko-fi donation link
that funds engineering time and explicitly buys no influence
(`replica/premium-position.md` §2, the co-owner's final decision). The paid/tier
model was rejected on the evidence in `replica/research-market.md` and
`replica/research-patreon.md`, which are retained in the repo as the record of
why. **A free launch does not delete the licence and trademark work below** —
free distribution is still distribution of a modified Mozilla binary.

| # | blocker | status | the file that establishes it |
| --- | --- | --- | --- |
| 1 | **A self-contained packaged artifact exists and boots.** ~~`packaging/linux/`'s tarball stage does not exist, and the proof file `replica/proofs-self-contained.md` is absent~~ → **both claims stale**: the self-contained build path is proven (`replica/proofs-self-contained.md`) and `packaging/linux/` carries `make-tarball.sh` + `make-deb.sh` + `DEPS.md` (473 lines) with `.github/workflows/build-packages.yml` written. ~~but **no artifact has been produced and booted yet**; `make-tarball.sh`'s first real run is in flight at this commit (`replica/TODAY.md` §2)~~ → **artifact produced, verified and booted 2026-10-16**: `make-tarball.sh` end-to-end PASS on the re-run after the §9.8 checker fix (stdlib `zipfile` cannot read omni.ja; the signing patch was intact) — `build/packaging/ziy-156.0.1-linux-x86_64.tar.xz`, 95,995,124 B ≈ 92M compressed / 336M unpacked, `.sha256` beside it; fresh-extraction boot under a throwaway HOME + profile: non-blank 1280x720 screenshot, 9/9 `ziy-*@ziy.app` add-ons `active=True`, engine `--version` = `Mozilla Firefox 156.0.1` (known behaviour). The headless process can hang after writing the screenshot — it needed `timeout`; the CI smoke step wraps it in `timeout 180` too | **DONE 2026-10-16** | `replica/TODAY.md` §2 · `packaging/linux/DEPS.md` §9.8 · `replica/proofs-self-contained.md` · `replica/premium-position.md` §2.5 item i |
| 2 | **A user-facing update path exists.** `tools/update-engine.sh` is the maintainer's engine-*bump* discipline, not a user update channel. The ten missing pieces are numbered in `research-tech.md` §4; items 1 (artifact channel) and 3 (staging/atomic swap) block everything after them | **BLOCKING — not done** | `replica/research-tech.md` §4 · `tools/update-engine.sh` |
| 3 | **The deploy gate passes against the packaged artifact.** Last full run is **54 passed / 0 failed / 2 skipped** on the rebuilt dev tree (§3, re-measured 2026-10-16; +6 rows from the compliance pass's §1 checks); it must still be re-run on the packaged artifact. The SKIPs this run: the engine `--version` string and a sync-e2e transfer-line SKIP that was **not** a flake — root-caused to a same-second pull-cursor bug, fixed and re-run green (`replica/proofs-sync.md` §7) | **BLOCKING — needs a re-run on the artifact** | §3 · `replica/premium-position.md` §2.5 item iii |
| 4 | **The MPL §3.2(a) source-availability notice ships in the app dir** — where to get the engine source and the five patches, with the MPL link. ~~**`build/ziy/` currently contains no license.txt at any depth ≤3**, and the upstream tarball ships none either~~ → **shipped 2026-10-16** (`LICENSES.txt` 2,775 B + `patches/`, build-shell stage 8b; verify §1 asserts all six checks) | **DONE** | `replica/research-legal.md` §2.4, §1.1 Rule 4 · `replica/proofs-compliance.md` |
| 5 | **`patches/` ships with the product**, MPL-licensed, internal notices untouched (§1.1 Rule 5). Present in the tree; ~~nothing yet ships it~~ → **wired 2026-10-16** (stage 8b copies all 5 patches + `README.md`; verify §1 counts ≥5 in the app dir) | **DONE** | `replica/research-legal.md` §1.1 · `patches/README.md` · `replica/proofs-compliance.md` |
| 6 | **The not-affiliated-with-Mozilla notice ships at equal prominence** with the permitted "built on Mozilla open source technology" sentence, on every user-facing surface. → **PARTIAL 2026-10-16**: ships in `LICENSES.txt` and the welcome footer; the About panel and any download page do not exist yet, so "every surface" is not yet true | **BLOCKING — partial** | `replica/research-legal.md` §2.2 · `replica/research-market.md` §4.3 Rule 1 · `replica/proofs-compliance.md` |
| 7 | **The residual `Mozilla Firefox` marks problem is resolved or disclosed** — `./build/ziy/firefox --version` still reports `Mozilla Firefox 156.0.1` (the string comes from `libxul` and cannot be remapped from `App:Name`), plus `updater.ini` and engine-named executables. → **DISCLOSED 2026-10-16**: the notice's residual-marks section names the `--version` string and the engine file names and points at the `ziy` entry point; the banner-string remap remains unattempted | **DISCLOSED — remap open** | `replica/research-legal.md` §2.3 · §4's limitations table · `replica/proofs-compliance.md` |
| 8 | **The filter-list licence table is complete for all seven lists** — ~~four of seven (`uabo-filters`, `urlhaus`, `antiadblock-warning-removal`, `brave-unbreak`) are missing from `extensions/ziy-shields/LICENSES`~~ → **all seven recorded 2026-10-16**, with the EasyList dual-licence branch chosen and stated (CC-BY-SA 3.0 for the compiled ruleset) | **DONE** | `replica/research-legal.md` §6.1, §6.3 · `replica/proofs-compliance.md` |
| 9 | **The Brave-patent skim** for the core features (shields model, sync phrase handling, farbling). Brave's own ToU warns that "features and/or functionality of Brave's products may be protected under Brave patent applications or patents" | **OPEN — no patent search has been run; UNVERIFIED** | `replica/research-legal.md` §3.3 (unmitigated row), §3.4 action 3 |
| 10 | **The Ko-fi page is live before the first public build announcement** — the donation link, the sentence that donations buy **time, not influence**, and the free download and build instructions beside it in the same breath. → **draft copy ready** (`replica/kofi-page-copy.md`); the co-owner applies it | **BLOCKING — ordering rule; copy ready** | `replica/premium-position.md` §2.5, §3, §6 item 6 · `replica/kofi-page-copy.md` |

**Explicitly NOT blockers for this launch** (each was an obligation of the
rejected paid model, recorded so the change is visible): the EU 14-day
withdrawal right and its working withdrawal function, the pre-contract disclosure
set (price, update period, guarantee of conformity), VAT/OSS registration and
the 10-year record-keeping duty, and the refund/withdrawal flow test. All four
attach to a *sale*; with no sale they are **NOT-APPLICABLE-now-sale** and are
marked as such in `replica/research-legal.md` §4.4. If the pricing model ever
changes, they return immediately.

**One new, small open item:** Ko-fi's own terms as they apply to
donation-supported software — what a supporter receives and what the page copy
may say. **UNVERIFIED** (not fetched in the research pass) and worth a check
before the page goes live. The rule that follows: the page must promise nothing
deliverable (`replica/premium-position.md` §2.4).

---

## 6. If something fails

| symptom | first thing to check |
| --- | --- |
| `./tools/ziy` says there is no app dir | run `./tools/build-shell.sh` first, or set `ZIY_APP_DIR` |
| the suite does not appear in `about:addons` | `ls build/ziy/distribution/extensions/` — run `./tools/build-extension.sh --all` |
| sync says the agent is unavailable | run `./tools/install-native.sh`; it writes the manifest and verifies the agent answers |
| the desktop entry does not appear in the launcher | run `./tools/install-desktop.sh`; it prints what it could not do |
| links still open another browser | run `./tools/install-desktop.sh --set-default` — it prints the command; Ziy will not change it for you |
| `./tools/verify.sh` reports a FAIL | the log line names the check; artefacts are in `build/verify/` |

`./tools/verify.sh --help` lists every section and its filter flag, so a single
slice can be run in isolation.
