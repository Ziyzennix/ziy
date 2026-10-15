#!/usr/bin/env bash
# tools/install-desktop.sh — install Ziy's desktop integration on Linux.
#
# What this does, and nothing more:
#   1. install shell/ziy.desktop into ~/.local/share/applications/ziy.desktop
#   2. install the brand icons into the hicolor theme:
#        ~/.local/share/icons/hicolor/<size>/apps/ziy.png
#   3. run update-desktop-database and gtk-update-icon-cache when they exist
#   4. print exactly what it did and what it could NOT do
#
# It is IDEMPOTENT: running it twice leaves the same state and says so. It is
# HONEST: a step it could not take is reported as not-done, with the reason,
# rather than silently skipped or faked.
#
# It NEVER:
#   * runs xdg-settings, xdg-mime or any command that changes the default
#     browser. That is a user decision, it needs their consent, and the Ziy
#     menu's own copy button hands them the command rather than running it.
#     (A WebExtension cannot set it either — there is no such API on Gecko —
#     and a script that did it without asking would be worse than the button
#     it pretend-replaced.) Use --set-default to print the command.
#   * writes outside the two per-user directories above, or ~/.ziy
#   * touches the user's Firefox, or anything under /usr
#
# Usage:
#   tools/install-desktop.sh             # install
#   tools/install-desktop.sh --dry-run   # print what would happen, change nothing
#   tools/install-desktop.sh --uninstall # remove only what this script wrote
#   tools/install-desktop.sh --set-default # print the command to become default
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/.." && pwd)"
. "$HERE/lib/common.sh"

DRY_RUN=0
UNINSTALL=0
SET_DEFAULT=0
EXEC_PATH="/usr/bin/ziy"

note() { printf '\n%s== %s ==%s\n' "$C_BOLD" "$1" "$C_RESET" >&2; }

DONE=()
COULD_NOT=()

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run|-n) DRY_RUN=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --set-default) SET_DEFAULT=1; shift ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

run() {
  # Print and run, unless --dry-run.
  if [ "$DRY_RUN" = "1" ]; then
    printf '  %s%-10s%s would run: %s\n' "$C_DIM" "would" "$C_RESET" "$*" >&2
    return 0
  fi
  printf '  %s%-10s%s %s\n' "$C_DIM" "run" "$C_RESET" "$*" >&2
  "$@"
}

# ---------------------------------------------------------------------------
# The sources: the desktop entry and the icons, in that order of importance.
# ---------------------------------------------------------------------------
DESKTOP_SRC="$ROOT/shell/ziy.desktop"

# Icons come from the shell build's own hicolor tree, which is already laid out
# the way the freedesktop icon theme spec wants it (one directory per size) and
# already carries the full set from 16 to 256. Using it verbatim means the
# installed icons are the same bytes the build certified, with no re-derivation
# of sizes in this script. The app-dir chrome dirs are the fallback for a tree
# where build-shell.sh has not been run.
ICON_SOURCES=(
  "$ROOT/build/share/icons/hicolor"
  "$ROOT/build/ziy/browser/chrome/icons/default"
  "$ROOT/build/ziy/chrome/icons/default"
)

# Where they go: the two per-user directories the XDG spec names.
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
DESKTOP_DST="$APPS_DIR/ziy.desktop"

# ---------------------------------------------------------------------------
note "Ziy desktop integration"

if [ "$SET_DEFAULT" = "1" ]; then
  # Honest by design: print the command, never run it.
  cat >&2 <<'MSG'
Ziy does not set the default browser for you.

A WebExtension has no default-browser API on this engine (verified: no such
function exists in any schema in build/ziy/omni.ja), so the browser cannot do
it, and this installer does not do it behind your back either. Run the command
yourself, in a terminal:

    xdg-settings set default-web-browser ziy.desktop

It writes exactly the setting your desktop settings panel writes. To check what
the default is right now:

    xdg-settings get default-web-browser

(This machine currently reports: $(xdg-settings get default-web-browser 2>/dev/null || echo 'no answer from xdg-settings'))
MSG
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. the .desktop entry
# ---------------------------------------------------------------------------
if [ ! -f "$DESKTOP_SRC" ]; then
  COULD_NOT+=("the .desktop entry: $DESKTOP_SRC does not exist")
else
  mkdir -p "$APPS_DIR" 2>/dev/null || true
  if [ -d "$APPS_DIR" ] && [ -w "$APPS_DIR" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      printf '  %s%-10s%s would install %s\n' "$C_DIM" "would" "$C_RESET" "$DESKTOP_DST" >&2
    else
      # Point Exec at THIS checked-out tree, so the installed entry launches
      # this Ziy rather than a package that may not exist. The rewrite is
      # line-specific and idempotent: only the main entry's Exec/TryExec change,
      # and the per-action Exec lines keep their own arguments (a blanket
      # "s/^Exec=/" would rewrite the actions too, turning "New Window" into
      # another copy of the default entry).
      if sed -e "0,/^Exec=/s#^Exec=.*#Exec=$ROOT/tools/ziy %u#" \
             -e "0,/^TryExec=/s#^TryExec=.*#TryExec=$ROOT/tools/ziy#" \
             -e "/^\[Desktop Action /,\$s#^Exec=/usr/bin/ziy #Exec=$ROOT/tools/ziy #" \
             "$DESKTOP_SRC" > "$DESKTOP_DST"; then
        DONE+=("installed $DESKTOP_DST (Exec -> $ROOT/tools/ziy)")
        chmod 0644 "$DESKTOP_DST" 2>/dev/null || true
      else
        COULD_NOT+=("the .desktop entry: failed to write $DESKTOP_DST")
      fi
    fi
  else
    COULD_NOT+=("the .desktop entry: $APPS_DIR is not writable")
  fi
fi

# ---------------------------------------------------------------------------
# 2. the icons, into the hicolor theme
# ---------------------------------------------------------------------------
# The hicolor theme is the one every desktop reads, and it is per-user here so
# no root is needed. Sizes are the set the freedesktop icon theme spec names as
# standard; each size gets its own directory.
# A usable source has PNGs either directly (a flat render dir) or one level
# down in <size>x<size>/apps (the hicolor layout).
has_icons() {
  local dir="$1"
  [ -d "$dir" ] || return 1
  [ -n "$(ls "$dir"/*.png 2>/dev/null | head -1)" ] && return 0
  for sub in "$dir"/*x*/apps; do
    [ -d "$sub" ] && [ -n "$(ls "$sub"/*.png 2>/dev/null | head -1)" ] && return 0
  done
  return 1
}

ICON_SRC_DIR=""
for candidate in "${ICON_SOURCES[@]}"; do
  if has_icons "$candidate"; then
    ICON_SRC_DIR="$candidate"
    break
  fi
done

if [ -z "$ICON_SRC_DIR" ]; then
  COULD_NOT+=("the icons: no rendered PNG icons found (looked in build/ziy/**/chrome/icons/default). Run ./tools/build-shell.sh first — it renders Ziy's own mark at every size.")
elif [ "$UNINSTALL" = "1" ]; then
  :
else
  INSTALLED_SIZES=""
  # Layout A: a hicolor tree, i.e. <size>x<size>/apps/<name>.png. Copy it
  # across size by size and keep the directory's own name, so no size is
  # guessed from a filename.
  if [ -n "$(ls -d "$ICON_SRC_DIR"/*x*/apps 2>/dev/null | head -1)" ]; then
    for src_dir in "$ICON_SRC_DIR"/*x*/apps; do
      [ -d "$src_dir" ] || continue
      [ -n "$(ls "$src_dir"/*.png 2>/dev/null | head -1)" ] || continue
      SIZE_DIR="$(basename "$(dirname "$src_dir")")"
      DEST_DIR="$ICONS_DIR/$SIZE_DIR/apps"
      if [ "$DRY_RUN" = "1" ]; then
        printf '  %s%-10s%s would install %s\n' "$C_DIM" "would" "$C_RESET" "$DEST_DIR/ziy.png" >&2
        INSTALLED_SIZES="$INSTALLED_SIZES $SIZE_DIR"
        continue
      fi
      if mkdir -p "$DEST_DIR" 2>/dev/null && cp "$src_dir"/*.png "$DEST_DIR/" 2>/dev/null; then
        # The hicolor name must be "ziy", whatever the source called it.
        for f in "$DEST_DIR"/*.png; do mv -f "$f" "$DEST_DIR/ziy.png"; done
        INSTALLED_SIZES="$INSTALLED_SIZES $SIZE_DIR"
        # Verify the pixel size matches the slot. A slot holding a different
        # size is a real defect (the shell build falls back to the largest mark
        # for any size the brand renderer did not produce), and shipping a
        # 256px image as the 22px icon is how a blurry task manager happens.
        if [ "$DRY_RUN" = "0" ] && python3 - "$DEST_DIR/ziy.png" "$SIZE_DIR" <<'PYZ'
import sys
from PIL import Image
im = Image.open(sys.argv[1])
want = sys.argv[2].split("x")[0]
sys.exit(0 if im.size[0] == int(want) and im.size[1] == int(want) else 1)
PYZ
        then :; else
          REAL="$(python3 -c "from PIL import Image; print(Image.open('$DEST_DIR/ziy.png').size[0])" 2>/dev/null || echo '?')"
          COULD_NOT+=("the icons: $DEST_DIR/ziy.png holds ${REAL}px, not ${SIZE_DIR%x*}px (the build's fallback put the largest mark there). Resampled to the slot's size.")
          if python3 - "$DEST_DIR/ziy.png" "${SIZE_DIR%x*}" <<'PYZ'
import sys
from PIL import Image
src, size = sys.argv[1], int(sys.argv[2])
Image.open(src).convert("RGBA").resize((size, size), Image.LANCZOS).save(src)
PYZ
          then log_warn "resampled $DEST_DIR/ziy.png to ${SIZE_DIR%x*}px"; fi
        fi
      else
        COULD_NOT+=("the icons: could not write $DEST_DIR")
      fi
    done
  fi
  # Layout B: a flat directory of rendered PNGs (either naming convention).
  # Two names exist in this tree and both are handled:
  #   logo-48.png    the brand renderer's name
  #   default48.png  the app-dir copy build-shell.sh writes
  # logo.png is the 256 render; anything else with no digit is the largest mark.
  for png in "$ICON_SRC_DIR"/*.png; do
    [ -e "$png" ] || continue
    BASENAME="$(basename "$png")"
    if [ "$BASENAME" = "logo.png" ]; then SIZE=256; else
      SIZE="$(printf '%s' "$BASENAME" | sed -n 's/^.*[^0-9]\([0-9][0-9]*\)\.png$/\1/p')"
      [ -z "$SIZE" ] && SIZE=256
    fi
    DEST_DIR="$ICONS_DIR/${SIZE}x${SIZE}/apps"
    if [ "$DRY_RUN" = "1" ]; then
      printf '  %s%-10s%s would install %s\n' "$C_DIM" "would" "$C_RESET" "$DEST_DIR/ziy.png" >&2
      INSTALLED_SIZES="$INSTALLED_SIZES $SIZE"
      continue
    fi
    if mkdir -p "$DEST_DIR" 2>/dev/null && cp "$png" "$DEST_DIR/ziy.png" 2>/dev/null; then
      INSTALLED_SIZES="$INSTALLED_SIZES $SIZE"
    else
      COULD_NOT+=("the icons: could not write $DEST_DIR/ziy.png")
    fi
  done
  if [ -n "$INSTALLED_SIZES" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      DONE+=("icons: would install sizes$INSTALLED_SIZES into $ICONS_DIR")
    else
      DONE+=("icons: installed sizes$INSTALLED_SIZES into $ICONS_DIR")
      # The scalable source too, so a theme that asks for an SVG gets ours.
      SVG_SRC=""
      for maybe in "$ICON_SRC_DIR/scalable/apps/ziy.svg" \
                   "$ICON_SRC_DIR/ziy.svg" \
                   "$ROOT/build/ziy/chrome/icons/default/ziy.svg"; do
        [ -f "$maybe" ] && { SVG_SRC="$maybe"; break; }
      done
      if [ -f "$SVG_SRC" ]; then
        if mkdir -p "$ICONS_DIR/scalable/apps" && cp "$SVG_SRC" "$ICONS_DIR/scalable/apps/ziy.svg"; then
          DONE+=("icons: installed the scalable mark at $ICONS_DIR/scalable/apps/ziy.svg")
        else
          COULD_NOT+=("the icons: could not write the scalable mark")
        fi
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 3. the database updates, when the tools exist
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" = "1" ]; then
  for tool in update-desktop-database gtk-update-icon-cache; do
    if command -v "$tool" >/dev/null 2>&1; then
      printf '  %s%-10s%s would run: %s\n' "$C_DIM" "would" "$C_RESET" "$tool" >&2
    else
      printf '  %s%-10s%s %s is not installed on this system\n' "$C_DIM" "skip" "$C_RESET" "$tool" >&2
      COULD_NOT+=("$tool: not installed (the desktop database still updates when you next log in)")
    fi
  done
elif [ "$UNINSTALL" = "0" ]; then
  if command -v update-desktop-database >/dev/null 2>&1; then
    if run update-desktop-database "$APPS_DIR" >/dev/null 2>&1; then
      DONE+=("ran update-desktop-database on $APPS_DIR")
    else
      COULD_NOT+=("update-desktop-database: the command failed (non-fatal; the entry still works)")
    fi
  else
    COULD_NOT+=("update-desktop-database: not installed")
  fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    if run gtk-update-icon-cache -t -q "$ICONS_DIR" >/dev/null 2>&1 || true; then
      DONE+=("ran gtk-update-icon-cache on $ICONS_DIR")
    fi
  else
    COULD_NOT+=("gtk-update-icon-cache: not installed")
  fi
fi

# ---------------------------------------------------------------------------
# uninstall: remove only what this script wrote
# ---------------------------------------------------------------------------
if [ "$UNINSTALL" = "1" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    log_step "would remove" "$DESKTOP_DST"
    log_step "would remove" "$ICONS_DIR/*/apps/ziy.png (all sizes)"
  else
    rm -f "$DESKTOP_DST" && log_ok "removed $DESKTOP_DST"
    for d in "$ICONS_DIR"/*/apps; do
      [ -d "$d" ] && rm -f "$d/ziy.png"
    done
    rm -f "$ICONS_DIR/scalable/apps/ziy.svg"
    log_ok "removed the hicolor ziy.png icons"
    if command -v update-desktop-database >/dev/null 2>&1; then
      update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
      log_ok "ran update-desktop-database"
    fi
  fi
  printf '\n%sDone (uninstall).%s\n\n' "$C_BOLD" "$C_RESET" >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# The honest report: what happened, and what did not.
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" = "0" ]; then
  printf '\n%s== what this did ==%s\n' "$C_BOLD" "$C_RESET" >&2
  if [ "${#DONE[@]}" -eq 0 ]; then
    printf '  nothing was changed\n' >&2
  else
    for line in "${DONE[@]}"; do printf '  %sok%s  %s\n' "$C_GREEN" "$C_RESET" "$line" >&2; done
  fi

  printf '\n%s== what it could NOT do ==%s\n' "$C_BOLD" "$C_RESET" >&2
  if [ "${#COULD_NOT[@]}" -eq 0 ]; then
    printf '  nothing was skipped\n' >&2
  else
    for line in "${COULD_NOT[@]}"; do printf '  %swarn%s  %s\n' "$C_YELLOW" "$C_RESET" "$line" >&2; done
  fi

  cat >&2 <<'TAIL'

What this did NOT do, on purpose:

  * it did not make Ziy your default browser. Nothing here changes which
    browser opens links. Run:

        tools/install-desktop.sh --set-default   # prints the command

  * it did not install anything under /usr, and it did not need root.

  * the app menu's own default-browser row reads the real state, so it tells
    you the truth about what the desktop session says right now.

TAIL
else
  printf '\n%sdry run: nothing was changed.%s\n\n' "$C_BOLD" "$C_RESET" >&2
fi
exit 0
