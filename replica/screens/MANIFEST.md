# Reference Screenshot Manifest — Brave internal pages

Captured 2026-10-14 against the user's local install: **Brave Origin 153.1.95.104** (Chromium 153.0.8010.53), package `brave-origin 1.95.104`.

**These files are design references only — never shipped.** They live in `replica/screens/` precisely so they are excluded from the product.

## Method (important, and honest)

Brave's own `--headless=new --screenshot=...` flag **hung indefinitely** on this machine (see § Limitations). Playwright (installed into `/tmp/screens-tool`, headless Chromium bundle) also failed: it launches Brave, the browser starts, but never finishes initialising the chrome UI under Playwright's forced flags and the launch times out at `browserContext.newPage`.

**What worked:** launching Brave with `--headless=new --remote-debugging-port=9222` on a throwaway profile, then driving the **real Brave binary's own CDP endpoint** and calling `Page.captureScreenshot` per tab. This is Brave's own UI, not another browser's — the `version.png` row below is the proof (it reports Brave Origin 1.95.104 / Chromium 153.0.8010.53).

Every capture was also verified against the page's live DOM (`document.title`, `location.href`, `innerText`) before being kept, so a page that exists but rendered empty would be reported as a failure, not passed off as a capture.

## Results

| filename | URL | captured | notes |
|---|---|---|---|
| brave.png | brave://newtab | **yes** | 1440×900, 1.36 MB. Full NTP: background photo credit "Photo by Elizabeth Gottwald", STATS widget (trackers/ads blocked, bandwidth saved, time saved). Verified via DOM. |
| shields-panel.png | brave://settings/shields | **yes** | 1440×900, 169 KB. Settings shell rendering to the Shields page; `document.title` = "Settings". Panel content is sparse in the viewport — the settings chrome occupies most of the frame. |
| rewards.png | brave://rewards | **no** | **Page does not exist in this build.** DOM reported `location.href = chrome-error://chromewebdata/`, `document.title = "brave://rewards/"`, body text: *"This site can't be reached … ERR_INVALID_URL"*. Recorded miss. |
| wallet.png | brave://wallet | **no** | **Page does not exist in this build.** Same `ERR_INVALID_URL` on `chrome-error://chromewebdata/`. Recorded miss. |
| leo.png | brave://leo-ai | **no** | **Page does not exist in this build.** Same `ERR_INVALID_URL` on `chrome-error://chromewebdata/`. Recorded miss. |
| sync.png | brave://settings/system | **yes** | 1440×900, 124 KB. DOM title "Settings - System". Used as `sync.png` per instruction (item 6). Settings chrome renders; the Sync sub-page body did not populate within the capture window. |
| history.png | brave://history | **yes** | 1440×900, 32 KB. DOM title "History", `location.href = chrome://history/` — the page exists. Profile history was empty, so the body is a sparse list shell. |
| downloads.png | brave://downloads | **yes** | 1440×900, 33 KB. DOM title "Downloads" — page exists; no download entries on this profile. |
| bookmarks.png | brave://bookmarks | **yes** | 1440×900, 25 KB. DOM title "Bookmarks", `location.href = chrome://bookmarks/` — page exists; bookmark store empty. |
| extensions.png | brave://extensions | **yes** | 1440×900, 44 KB. DOM title "Extensions" — page exists; no extensions visible on the throwaway profile. |
| version.png | brave://version | **yes** | 1440×900, 176 KB. Rich content, DOM text: *"Brave Software Inc. Copyright © 2026 The Brave Authors. All rights reserved. Brave Origin 1.95.104 Chromium: 153.0.8010.5…"*. Proves the capture is Brave's own UI. |
| settings-main.png | brave://settings | **yes** | 1440×900, 98 KB. DOM title "Settings" — settings root page. |

**Captured: 9 of 12. Missed: 3 of 12** (rewards, wallet, leo — all three genuinely absent from this build, confirmed by DOM, not by a blank image).

## Limitations

- **No truly clean headless run was achieved.** Brave was launched with `--headless=new` plus `--disable-gpu --no-sandbox --disable-dev-shm-usage --disable-crash-reporter`. `Xvfb`/`xvfb-run` are **not installed** on this machine, and `apt` cannot install them (no passwordless sudo), so a virtual display was not available.
- **Brave's `--screenshot` flag never produced a PNG.** It ran for the full 90–150 s timeout on every attempt, including against a plain `data:` URL, so the fault is in the browser's screenshot path here, not in any target page. No PNG from that path is included above.
- **Playwright with Brave's binary does not work on this machine.** The launch times out before the chrome UI finishes; `npx playwright install chromium` does install a working headless Chromium bundle, but that bundle is not Brave and is therefore not used for these reference shots. If a future pass can drive Playwright's headless shell *and* render Brave's chrome UI, the sparse-body pages (settings, history, downloads, bookmarks, extensions) would benefit from a re-capture with full `waitUntil: 'networkidle'` and a longer settle time.
- **No visible window was left running.** Brave's headless instance under CDP did not appear in `wmctrl` output (the only Brave window present was the user's own "WhatsApp - Brave Origin", which was never touched). The throwaway profile was at `/tmp/brave-recon-profile` and has been removed.
- **Process hygiene note:** an early `pkill -f 'brave'` pattern was too broad — it matched the user's LibreOffice documents (the project directory is named "brave but not chrome or firefox") and killed one of their sessions. All later process handling was scoped to `/usr/bin/brave-origin` and `brave-recon-profile` only. No further over-broad kills were made.

## Reproduction

```bash
rm -rf /tmp/brave-recon-profile
setsid /usr/bin/brave-origin-stable \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/brave-recon-profile \
  --no-first-run --no-default-browser-check --no-proxy-server \
  --disable-crash-reporter --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --headless=new < /dev/null > /tmp/dbg.log 2>&1 &
```
Then, per page: `PUT http://127.0.0.1:9222/json/new?<url>` → connect the returned `webSocketDebuggerUrl` → `Page.enable` + `Emulation.setDeviceMetricsOverride` (1440×900) → wait → `Page.captureScreenshot` → base64-decode to PNG.
