# brand/ — app icon masters (drop here)

App icon masters + rasters for the desktop/taskbar/window/About/store icon.
Filenames: `logo.svg`, `logo-{16,22,24,32,48,64,96,128,256}.png`, `ziy.png`
(256), `logo-dark.svg`, `logo-inactive.svg`, `wordmark*.svg`. `build-shell.sh`
reads `brand/logo.svg` and rasterises from it (`shell/brand-fallback/render-icons.py`),
so landing files here supersedes the violet fallback automatically.

Replace the placeholder 1:1, don't delete anything else.
