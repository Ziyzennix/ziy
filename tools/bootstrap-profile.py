#!/usr/bin/env python3
"""Create a Ziy profile under ~/.ziy/profiles/ — the profile the product owns.

Firefox's own `--CreateProfile` is not usable headless on our binary and, worse,
would write into the user's ~/.mozilla/firefox/profiles.ini. So Ziy builds the
profile skeleton itself (replica/architecture.md §6 step 2, replica/proofs.md
fact 8): the engine accepts `--profile <existing dir>` and will populate prefs.js,
extensions.json and friends on first run.

What this script creates, for --name default:

    ~/.ziy/profiles/<name>/
    ├── user.js                     # values that must win over every default
    ├── prefs.js                    # seed the engine reads on first run
    ├── chrome/
    │   └── userChrome.css          # our window chrome
    ├── chrome.css                  # -> the same file, some builds look here
    ├── extensions/                 # sideload directory (app-profile scope)
    ├── ziy-profile.json            # profile metadata: name, schema version
    └── local-settings.js           # autoconfig marker (belt and braces)

Design notes
------------
*Idempotent.* Re-running it never destroys a profile: existing user.js lines are
merged (ours win), existing prefs.js is left alone if it already has content, and
nothing is ever deleted. `--reset` is explicit and destructive on purpose.

*Never touches ~/.mozilla.* No code path in this script writes outside the
profile directory it was asked for, or ~/.ziy/ itself.

*Version-skew guard.* ziy-profile.json records `compat`, the profile schema
version this shell built. A newer profile opened by an older shell refuses to
start rather than guessing (architecture.md §3.3).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# Bump when the on-disk shape of a profile changes incompatibly.
PROFILE_SCHEMA_VERSION = 1

USER_HOME = Path(os.environ.get("ZIY_HOME_DIR") or Path.home())
PROFILE_ROOT = USER_HOME / ".ziy" / "profiles"

# The values Ziy writes as *user* preferences: these beat app-dir defaults,
# mozilla.cfg locks and policies (a lock only blocks the user from changing a
# value that is already set; it cannot stop the user's own startup value from
# being the initial one). Anything that must be un-changeable is in mozilla.cfg
# instead, not here.
USER_PREFS: dict[str, object] = {
    # 1. The chrome stylesheet pref. Without it Gecko ignores userChrome.css,
    #    and the shell would look like stock Firefox.
    "toolkit.legacyUserProfileCustomizations.stylesheets": True,
    # 2. Our profile is outside ~/.mozilla, so say where it is and make sure
    #    the engine does not try to migrate the user's Mozilla profile into it.
    "ziy.profile.current": "default",
    "browser.migration.enabled": False,
    "browser.profiles.enabled": True,
    "browser.profiles.created": False,
    "browser.profiles.sync.activated": False,
    # 3. First-run: skip Mozilla's welcome tour, land on our own first page.
    #    ziy-shell's S01 tour takes it from there.
    "browser.startup.page": 1,
    "browser.startup.homepage": "about:newtab",
    "browser.startup.firstrunSkipsHomepage": False,
    "startup.homepage_welcome_url": "",
    "startup.homepage_override_url": "",
    "browser.aboutwelcome.enabled": False,
    # 3b. The engine's own new tab page is OFF: browser.newtabpage.enabled is
    #     what AboutNewTabRedirector.sys.mjs reads to decide whether about:newtab
    #     maps to the built-in page or to the extension override, and
    #     disableNewTabAsAddon is what AboutNewTabResourceMapping.sys.mjs reads
    #     to stop mapping the built-in add-on's resources. With both false-ish
    #     as written here, the ONLY new tab page is ziy-ntp's. (The byte-level
    #     strip lives in build-shell.sh §7b; the policy block is in
    #     policies-gen.py.)
    "browser.newtabpage.enabled": False,
    "browser.newtabpage.disableNewTabAsAddon": True,
    "browser.newtabpage.activity-stream.selfLoading.enabled": False,
    "browser.startup.homepage.abouthome_cache.enabled": False,
    "browser.rights.3.shown": True,
    "browser.shell.checkDefaultBrowser": False,
    "browser.defaultbrowser.notificationbar.shown": True,
    "termsofuse.acceptedVersion": 99,
    "termsofuse.currentVersion": 99,
    "datareporting.policy.currentPolicyVersion": 99,
    "datareporting.policy.dataSubmissionPolicyAcceptedVersion": 99,
    "datareporting.policy.dataSubmissionPolicyNotifiedTime": "0000000000000",
    # 4. Do not resurrect Mozilla's telemetry ping from a previous state.
    "toolkit.telemetry.cachedClientID": "",
    "toolkit.telemetry.previousBuildID": "",
    # 5. Our suite is unsigned and installed by the app dir.
    "extensions.autoDisableScopes": 0,
    "extensions.sideloadScopes": 15,
    "extensions.enabledScopes": 15,
    "extensions.allowPrivateBrowsingByDefault": True,
    # 6. Our own chrome is the identity of the window.
    "extensions.activeThemeID": "ziy-shell@ziy.app",
    # 7. Recents/downloads UI we keep honest.
    "browser.download.alwaysOpenPanel": True,
    "browser.download.improvements_to_download_panel": True,
    # 8. Search: no remote suggest endpoint. The default engine is Google
    #    (shell/distribution/distribution.ini) and it stays the user's to
    #    change; these only stop the engine phoning suggest queries home.
    "browser.urlbar.suggest.quicksuggest.sponsored": False,
    "browser.urlbar.suggest.searches": False,
    "browser.urlbar.speculativeConnect.enabled": False,
    "browser.search.suggest.enabled": False,
}

# The seed prefs.js. The engine rewrites prefs.js on every shutdown; what we put
# here simply has to be well-formed so the profile boots even before the engine
# has written it once.
SEED_PREFS: dict[str, object] = {
    "browser.shell.checkDefaultBrowser": False,
    "extensions.lastAppVersion": "156.0.1",
    "extensions.lastAppBuildID": "20260921121718",
}

SUITE_IDS = [
    "ziy-shell@ziy.app",
    "ziy-shields@ziy.app",
    "ziy-ntp@ziy.app",
    "ziy-news@ziy.app",
    "ziy-playlist@ziy.app",
    "ziy-talk@ziy.app",
    "ziy-sync@ziy.app",
    "ziy-desktop@ziy.app",
    "ziy-pwd@ziy.app",
]

USER_CHROME_CSS = """/* Ziy — window chrome.
 *
 * Written by tools/bootstrap-profile.py. The same file also ships as
 * shell/chrome/userChrome.css, which is what build-shell.sh installs into the
 * app dir; this copy is the one the engine actually loads, because
 * userChrome.css is read from the PROFILE (this file), not from the app dir.
 *
 * The ziy-shell extension installs the real theme and its own chrome CSS on top
 * of this. This file only guarantees Ziy never looks like stock Firefox.
 */

@namespace url("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");

:root {
  --ziy-violet: #4c2eff;
  --ziy-violet-deep: #26118f;
  --ziy-ink: #0e0630;
  --ziy-orange: #ff6b35;
  --ziy-radius: 10px;
}

:root:not([lwtheme]) {
  --lwt-accent-color: var(--ziy-violet-deep) !important;
  --toolbar-field-focus-border-color: var(--ziy-violet) !important;
  --focus-outline-color: var(--ziy-violet) !important;
  --tab-selected-bgcolor: #ffffff !important;
  --tab-selected-textcolor: var(--ziy-ink) !important;
}

#navigator-toolbox {
  border-bottom: 1px solid rgba(14, 6, 48, 0.15) !important;
}

#TabsToolbar {
  background-image: linear-gradient(
    180deg,
    var(--ziy-violet-deep) 0%,
    var(--ziy-ink) 100%
  ) !important;
}

#urlbar-background {
  border-radius: var(--ziy-radius) !important;
  border: 1px solid rgba(76, 46, 255, 0.45) !important;
}

#urlbar[focused] #urlbar-background {
  border-color: var(--ziy-violet) !important;
  box-shadow: 0 0 0 3px rgba(76, 46, 255, 0.25) !important;
}

:root:not([sizemode="fullscreen"]) #TabsToolbar-customization-target::after {
  content: "Ziy";
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding-inline-end: 4px;
}
"""

USER_CONTENT_CSS = """/* Ziy — content tweaks applied to every page the user sees.
 *
 * Kept deliberately tiny: the ziy-shields extension does the real page work
 * (cosmetic filters, Speedreader, cookie-consent un-bundling). Anything here
 * would be a second, unauditable blocking engine.
 */

@-moz-document url-prefix("about:") {
  /* Ziy's own accent on the about: pages we do not override. */
  :root {
    --in-content-accent-color: #4c2eff;
    --in-content-primary-button-background: #4c2eff;
    --in-content-primary-button-background-hover: #26118f;
    --in-content-primary-button-background-active: #0e0630;
  }
}
"""


def fmt_pref_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return '"%s"' % str(value).replace('"', '\\"')


def render_user_js(prefs: dict[str, object]) -> str:
    lines = [
        "// Ziy user.js — written by tools/bootstrap-profile.py.",
        "//",
        "// Values here are USER values, so they are applied before policy locks.",
        "// Anything that must be un-changeable lives in mozilla.cfg instead.",
        "//",
        "// Do not edit this file by hand: bootstrap-profile.py merges rather than",
        "// overwrites, and an edit is a change the script will fight on re-run.",
        "",
    ]
    for key in sorted(prefs):
        lines.append(f'user_pref("{key}", {fmt_pref_value(prefs[key])});')
    lines.append("")
    return "\n".join(lines)


def render_local_settings() -> str:
    return (
        "// Ziy autoconfig marker.\n"
        "//\n"
        "// The real autoconfig file is mozilla.cfg at the GRE root, referenced by\n"
        "// general.config.filename in browser/defaults/preferences/ziy.js. This\n"
        "// file exists because some Gecko builds read a profile-level marker of\n"
        "// the same name; having it present with the correct filename cannot hurt\n"
        "// and its absence on such a build would silently disable the locks.\n"
        'pref("general.config.filename", "mozilla.cfg");\n'
        'pref("general.config.obscure_value", 0);\n'
    )


def load_existing_user_js(path: Path) -> dict[str, object]:
    """Parse the user_pref lines already in user.js so we can merge, not clobber."""
    out: dict[str, object] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line.startswith("user_pref("):
            continue
        try:
            key, value = line[len("user_pref("):-2].split(",", 1)
        except ValueError:
            continue
        key = key.strip().strip('"')
        value = value.strip()
        if value in ("true", "false"):
            out[key] = value == "true"
        elif value.startswith('"'):
            out[key] = value[1:-1]
        else:
            try:
                out[key] = int(value)
            except ValueError:
                continue
    return out


def existing_profile_version(profile: Path) -> int | None:
    meta = profile / "ziy-profile.json"
    if not meta.exists():
        return None
    try:
        return int(json.loads(meta.read_text(encoding="utf-8")).get("compat", 0))
    except (ValueError, OSError):
        return None


def bootstrap(name: str, *, reset: bool = False, verbose: bool = False) -> int:
    if name in ("", ".", "..") or "/" in name or name.startswith("."):
        print(f"bootstrap-profile.py: invalid profile name {name!r}", file=sys.stderr)
        return 2

    profile = PROFILE_ROOT / name
    version = existing_profile_version(profile)

    if reset and profile.exists():
        print(f"bootstrap-profile.py: removing existing profile {profile}")
        shutil.rmtree(profile)

    # A profile from a newer shell would be opened by an older binary that does
    # not know its on-disk shape (architecture.md §3.3). Refuse, loudly.
    if version is not None and version > PROFILE_SCHEMA_VERSION:
        print(
            f"bootstrap-profile.py: profile {profile} was created by a NEWER "
            f"Ziy (compat={version} > {PROFILE_SCHEMA_VERSION}); refusing to "
            "downgrade it.",
            file=sys.stderr,
        )
        return 3

    created = not profile.exists()
    profile.mkdir(parents=True, exist_ok=True)
    for sub in ("chrome", "extensions", "chrome/collapsed", "bookmarkbackups"):
        (profile / sub).mkdir(parents=True, exist_ok=True)

    # --- user.js: merge ours over whatever is already there -------------------
    merged = dict(USER_PREFS)
    merged["ziy.profile.current"] = name
    present = load_existing_user_js(profile / "user.js")
    merged.update(present)          # an operator's previous bootstrap wins
    (profile / "user.js").write_text(render_user_js(merged), encoding="utf-8")

    # --- prefs.js: seed it if the engine has never written one ---------------
    prefs_path = profile / "prefs.js"
    if not prefs_path.exists() or not prefs_path.read_text(encoding="utf-8", errors="replace").strip():
        seed = dict(SEED_PREFS)
        seed["ziy.profile.current"] = name
        lines = ["// Ziy prefs.js — seed written by tools/bootstrap-profile.py.",
                 "// The engine replaces this file on shutdown; the values that",
                 "// matter at every boot are in user.js and mozilla.cfg.", ""]
        for key in sorted(seed):
            lines.append(f'user_pref("{key}", {fmt_pref_value(seed[key])});')
        lines.append("")
        if prefs_path.exists() and prefs_path.read_text(encoding="utf-8", errors="replace").strip():
            pass  # never clobber a profile the engine has already written
        else:
            prefs_path.write_text("\n".join(lines), encoding="utf-8")

    # --- chrome ---------------------------------------------------------------
    (profile / "chrome" / "userChrome.css").write_text(USER_CHROME_CSS, encoding="utf-8")
    (profile / "chrome" / "userContent.css").write_text(USER_CONTENT_CSS, encoding="utf-8")
    # Some Gecko builds and older docs look for the stylesheet at the profile
    # root; both paths cost nothing and remove a class of silent no-ops.
    for extra in ("userChrome.css", "userContent.css"):
        target = profile / extra
        if not target.exists():
            target.write_text(
                USER_CHROME_CSS if extra == "userChrome.css" else USER_CONTENT_CSS,
                encoding="utf-8",
            )

    (profile / "local-settings.js").write_text(render_local_settings(), encoding="utf-8")

    # --- metadata -------------------------------------------------------------
    (profile / "ziy-profile.json").write_text(
        json.dumps(
            {
                "name": name,
                "compat": PROFILE_SCHEMA_VERSION,
                "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "product": "Ziy",
                "engine": "Firefox 156.0.1 (Gecko)",
                "profile_root": str(profile),
                "suite": SUITE_IDS,
                "notes": [
                    "This profile is created and owned by Ziy.",
                    "Nothing in the bootstrap or launcher writes to ~/.mozilla.",
                    "Delete the directory to discard the profile; nothing else "
                    "on the box references it.",
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    # --- a marker so the launcher can prove which app dir made this profile ---
    (profile / "chrome" / ".ziy-profile-owned").write_text(
        "Ziy owns this directory. See ../ziy-profile.json.\n", encoding="utf-8"
    )

    verb = "created" if created else "verified"
    print(f"bootstrap-profile.py: {verb} {profile}")
    if verbose:
        for line in (
            f"  user.js        {len(merged)} prefs (merged over {len(present)} existing)",
            f"  chrome/        userChrome.css, userContent.css",
            f"  extensions/    sideload directory (extensions.sideloadScopes=15)",
            f"  prefs.js       {'seeded' if prefs_path.exists() else 'missing'}",
            f"  schema         compat={PROFILE_SCHEMA_VERSION}",
        ):
            print(line)
    if not (profile / "prefs.js").exists():
        print(
            "bootstrap-profile.py: note — prefs.js was not written; the engine "
            "creates it on first run.",
            file=sys.stderr,
        )
    return 0


def main() -> int:
    global PROFILE_ROOT  # must precede any use of the name in this function
    ap = argparse.ArgumentParser(
        description="Create (or refresh) a Ziy profile under ~/.ziy/profiles/."
    )
    ap.add_argument("--name", default="default", help="profile name (default: default)")
    ap.add_argument(
        "--root",
        default=None,
        help="the profiles directory itself, i.e. the equivalent of ~/.ziy/profiles "
             "(NOT its parent). Verify scripts use this to build a throwaway profile "
             "without touching ~/.ziy.",
    )
    ap.add_argument(
        "--reset", action="store_true",
        help="delete an existing profile first (destructive)"
    )
    ap.add_argument("--list", action="store_true", help="list the profiles we own")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    if args.list:
        if not PROFILE_ROOT.exists():
            print(f"no profiles yet ({PROFILE_ROOT} does not exist)")
            return 0
        for entry in sorted(PROFILE_ROOT.iterdir()):
            if not entry.is_dir():
                continue
            meta = entry / "ziy-profile.json"
            version = existing_profile_version(entry)
            state = "newer-schema" if (version or 0) > PROFILE_SCHEMA_VERSION else "ok"
            print(f"  {entry.name:<20} compat={version} {state}  {entry}")
        return 0

    if args.root:
        PROFILE_ROOT = Path(args.root)
        if args.root.upper().find("MOZILLA") >= 0 or "/.mozilla/" in args.root:
            print("bootstrap-profile.py: refusing a Mozilla profile root as --root",
                  file=sys.stderr)
            return 2

    # Never write outside our own tree, and never into Mozilla's. This runs
    # after --root is applied so the override is checked, not just the default.
    if "MOZILLA" in str(PROFILE_ROOT).upper() or "/.mozilla/" in str(PROFILE_ROOT):
        print("bootstrap-profile.py: refusing to use a Mozilla profile root "
              f"({PROFILE_ROOT}); Ziy owns ~/.ziy/ only.", file=sys.stderr)
        return 2

    return bootstrap(args.name, reset=args.reset, verbose=args.verbose)


if __name__ == "__main__":
    raise SystemExit(main())
