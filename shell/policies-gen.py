#!/usr/bin/env python3
"""Generate shell/distribution/policies.json for Ziy.

This script is the reason policies.json is schema-correct rather than merely
plausible: it builds the document from the Firefox 156 policy schema extracted
out of the installed engine (browser/omni.ja -> modules/policies/policies-schema.json)
and validates the result against that exact schema with jsonschema before
writing. If a policy name or key we depend on is not in the engine's schema,
this script fails loudly instead of shipping a file that about:policies will
report as an error.

Run it directly to regenerate; tools/build-shell.sh calls it so a build always
carries a freshly-validated file.

    python3 shell/policies-gen.py [--check]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SOURCE_HINTS = (
    "/usr/lib/firefox/browser/omni.ja",
    "/opt/firefox/browser/omni.ja",
)
OUT_PATH = REPO_ROOT / "shell" / "distribution" / "policies.json"
SCHEMA_CACHE = REPO_ROOT / "shell" / "omni.ja.patch" / "policies-schema.json"

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

# The disabled-API list from architecture.md §5.4. Every one of these is a
# dom.* pref (or a device.* one), so every one of them is inside the policy
# `Preferences` allowedPrefixes set.
#
# DEAD-NAME AUDIT (replica/proofs-cpp-privacy.md §2.1, §2.5): five names this
# list used to carry had no matching pref in the engine, so the locks were
# silent no-ops. Three of them were wrong names for existing prefs (renamed
# below); the rest are APIs Gecko 156.0.1 does not implement at all (deleted).
#   dom.serial.enabled      -> engine name is dom.webserial.enabled
#                              (StaticPrefList.yaml:6205, Navigator.webidl:254)
#   dom.filesystem.enabled  -> engine name is dom.fs.enabled
#                              (StaticPrefList.yaml:5384, FileSystemHandle.webidl:10)
#   dom.webbluetooth.enabled / dom.nfc.enabled / dom.idle-detector.enabled
#                           -> no such interface in dom/webidl/, so there is
#                              nothing to gate and no pref to lock. Do not
#                              re-add them: the engine has no consumer.
#   dom.security.featurePolicy.enabled -> no bare name; only .{header,
#                              experimental,webidl}.enabled exist, and renaming
#                              to a variant would silently narrow the gate, so
#                              it was deleted rather than guessed.
# device.sensors.enabled is the addition that closes the recon's sensor API: it
# IS implemented (read at nsGlobalWindowInner.cpp:3622-3635, gating all four
# sensor event interfaces) and was previously not disabled in any layer.
DISABLED_APIS = [
    "dom.battery.enabled",
    "dom.webserial.enabled",
    "dom.fs.enabled",
    "dom.netinfo.enabled",
    "dom.event.contextmenu.enabled",
    "device.sensors.enabled",
]

LOCKED_TELEMETRY = [
    "datareporting.healthreport.uploadEnabled",
    "datareporting.policy.dataSubmissionEnabled",
    "datareporting.usage.uploadEnabled",
    "toolkit.telemetry.enabled",
    "toolkit.telemetry.unified",
    "toolkit.telemetry.archive.enabled",
    "toolkit.telemetry.newProfilePing.enabled",
    "toolkit.telemetry.shutdownPingSender.enabled",
    "toolkit.telemetry.firstShutdownPing.enabled",
    "toolkit.telemetry.bhrPing.enabled",
    "toolkit.telemetry.server",
    "app.normandy.enabled",
    "app.normandy.first-run",
    "app.shield.optoutstudies.enabled",
    "browser.ping-centre.telemetry",
    "browser.discovery.enabled",
]

LOCKED_NETWORK = [
    "network.dns.disablePrefetch",
    "network.dns.disablePrefetchFromHTTPS",
    "network.predictor.enabled",
    "network.captive-portal-service.enabled",
    "network.dns.echconfig.enabled",
    "network.trr.mode",
    "network.http.sendRefererHeader",
    "network.http.referer.XOriginPolicy",
    "dom.security.https_only_mode",
    "network.cookie.cookieBehavior",
]
# Deleted from this list (no such pref in the engine — 0 occurrences in
# StaticPrefList.yaml and all.js; locking them was a no-op. Do not re-add):
#   network.cookie.lifetimePolicy
#       The engine's cookie-age control is network.cookie.maxageCap; the
#       "expire cookies" intent is carried by the Cookies policy's
#       ExpireAtSessionEnd / AcceptThirdParty settings, not by this name.
#   privacy.partition.network_state.ocsp_cache
#   privacy.partition.network_state.cookie_cache
#   privacy.partition.serviceWorkers
#       The only privacy.partition.* prefs that exist are
#       privacy.partition.bloburl_per_partition_key and
#       privacy.partition.network_state.connection_with_proxy
#       (StaticPrefList.yaml:18269/:18281). The state partitioning these names
#       were reaching for is already enforced by network.cookie.cookieBehavior
#       above. See replica/proofs-cpp-privacy.md §2.1 and §2.5.

LOCKED_TRACKING_PROTECTION = [
    "privacy.trackingprotection.enabled",
    "privacy.trackingprotection.pbmode.enabled",
    "privacy.trackingprotection.cryptomining.enabled",
    "privacy.trackingprotection.fingerprinting.enabled",
    "privacy.trackingprotection.emailtracking.enabled",
    "privacy.trackingprotection.socialtracking.enabled",
]

# Telemetry prefs whose locked value is a string or an integer rather than a
# boolean. Everything else in LOCKED_TELEMETRY locks to false.
TELEMETRY_STRINGS = {
    # Server endpoint: blank, so even if a pref somewhere re-enables a ping the
    # ping has nowhere to go.
    "toolkit.telemetry.server": "",
}
TELEMETRY_NUMBERS = {
    "datareporting.policy.firstrunTime": 0,
    "toolkit.telemetry.newProfilePing.delay": 0,
}


def read_engine_schema() -> tuple[dict, str]:
    """Pull policies-schema.json out of the installed engine's browser/omni.ja.

    Returns (schema, provenance). Raises SystemExit if no engine is found.
    """
    for path in SCHEMA_SOURCE_HINTS + (str(os.environ.get("ZIY_ENGINE", "") or ""),):
        if not path or not os.path.exists(path):
            continue
        data = Path(path).read_bytes()
        # omni.ja is a zip whose central directory lives inside the container's
        # 4-byte prefixed envelope: slice it out the same way the omni.ja
        # patcher does. See shell/omni.ja.patch/patch-omni.py.
        try:
            schema_bytes = member_from_omni(data, "modules/policies/policies-schema.json")
        except KeyError:
            continue
        SCHEMA_CACHE.parent.mkdir(parents=True, exist_ok=True)
        SCHEMA_CACHE.write_bytes(schema_bytes)
        return json.loads(schema_bytes.decode("utf-8")), str(path)
    if SCHEMA_CACHE.exists():
        return json.loads(SCHEMA_CACHE.read_text(encoding="utf-8")), f"cache {SCHEMA_CACHE}"
    sys.exit(
        "policies-gen.py: no Firefox install found to read the policy schema from "
        f"(tried {', '.join(p for p in SCHEMA_SOURCE_HINTS if p)}); cannot "
        "guarantee the generated policies.json is schema-correct."
    )


def member_from_omni(data: bytes, member: str) -> bytes:
    """Extract a stored (uncompressed) member from an omni.ja container."""
    eocd = data.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise ValueError("no EOCD found; not an omni.ja")
    cd_size, cd_off = struct.unpack("<II", data[eocd + 12 : eocd + 20])
    cd_start = cd_off  # the central directory begins 4 bytes into the file
    with zipfile.ZipFile(io_BytesIO(data, cd_start, cd_size)) as zf:
        info = zf.getinfo(member)
        base = 4
        h = base + info.header_offset
        nlen, elen = struct.unpack("<HH", data[h + 26 : h + 30])
        body = h + 30 + nlen + elen
        raw = data[body : body + info.compress_size]
        if len(raw) != info.file_size:
            raise ValueError(f"short read for {member}")
        return raw


def io_BytesIO(data, start, length):
    import io

    return io.BytesIO(data[start : start + length + 22])


def build_policies() -> dict:
    """Compose the Ziy policy document."""
    ext_settings = {
        # Everything Mozilla ships stays allowed unless it is in the suite
        # list; our ids below force_install from the app dir's
        # distribution/extensions/ directory.
        "*": {
            "installation_mode": "allowed",
            "allowed_types": ["extension", "theme", "dictionary", "locale", "sitepermission"],
            "blocked_install_message": "Ziy only accepts extensions listed in "
            "its ExtensionSettings policy.",
        }
    }
    for addon_id in SUITE_IDS:
        ext_settings[addon_id] = {
            "installation_mode": "normal_installed",
            # No install_url: the XPI already lives in our own
            # distribution/extensions/, which is where the app-scope installer
            # picks it up. Pointing at a URL would make the engine fetch over
            # the network, which a privacy product should not do.
            "default_area": "navbar",
            "private_browsing": True,
        }

    # Mozilla's OWN new tab page is a built-in add-on (newtab@mozilla.org), and
    # it is the only other newtab claimant in the product. It is blocked here,
    # at the policy layer, as the third and outermost strip of Firefox's new
    # tab: the browser/omni.ja byte patch makes it uninstallable
    # (build-shell.sh §7b), the prefs stop its resource mapping
    # (browser.newtabpage.enabled / disableNewTabAsAddon), and this entry
    # refuses it as an add-on no matter what the other two do. Blocking is
    # documented as "removes it from the device if already installed", which is
    # exactly the behaviour we want for an add-on whose page we do not ship.
    ext_settings["newtab@mozilla.org"] = {
        "installation_mode": "blocked",
        "blocked_install_message": "Ziy ships its own new tab page "
                                   "(ziy-ntp); Firefox's built-in new tab is not part of this product.",
    }

    prefs = {}
    for name in DISABLED_APIS:
        prefs[name] = {"Value": False, "Status": "locked", "Type": "boolean"}
    for name in LOCKED_TELEMETRY:
        if name in TELEMETRY_STRINGS:
            value = TELEMETRY_STRINGS[name]
        elif name in TELEMETRY_NUMBERS:
            prefs[name] = {"Value": TELEMETRY_NUMBERS[name], "Status": "locked",
                           "Type": "number"}
            continue
        else:
            value = False
        prefs[name] = {"Value": value, "Status": "locked",
                       "Type": "string" if isinstance(value, str) else "boolean"}
    # Explicit value per network pref. These are all "the protective value is
    # true" except the three integer-shaped ones below.
    network_true = [
        "network.dns.disablePrefetch",
        "network.dns.disablePrefetchFromHTTPS",
        "network.captive-portal-service.enabled",
        "network.dns.echconfig.enabled",
    ]
    # The pref's own name says what we want; "predictor off" is a false value.
    network_false = [
        "network.predictor.enabled",
    ]
    network_numbers = {
        "network.trr.mode": 5,
        "network.http.sendRefererHeader": 2,
        "network.http.referer.XOriginPolicy": 1,
        "network.cookie.cookieBehavior": 5,
        "dom.security.https_only_mode": 1,
    }
    for name in LOCKED_NETWORK:
        if name in network_numbers:
            prefs[name] = {"Value": network_numbers[name], "Status": "locked",
                           "Type": "number"}
        elif name in network_false:
            prefs[name] = {"Value": False, "Status": "locked", "Type": "boolean"}
        elif name in network_true:
            prefs[name] = {"Value": True, "Status": "locked", "Type": "boolean"}
        else:
            raise SystemExit(f"policies-gen.py: unmapped network pref {name}")
    for name in LOCKED_TRACKING_PROTECTION:
        prefs[name] = {"Value": True, "Status": "locked", "Type": "boolean"}

    # The remaining locked values that are neither plain booleans nor already
    # covered by a per-group loop above. `dom.security.https_only_mode` is a
    # boolean pref in this engine (verifiable in StaticPrefList.yaml), so it is
    # locked as a boolean in the networked groups, not here.
    LOCKED_MISC = {
        "privacy.fingerprintingProtection.enabled": (True, "boolean"),
        "privacy.fingerprintingProtection.pbmode": (True, "boolean"),
        # The RFPTargets.inc target list. `+AllTargets,-CSSPrefersColorScheme`
        # keeps the colour-scheme query honest for the dark/light theme picker.
        "privacy.fingerprintingProtection.overrides": (
            "+AllTargets,-CSSPrefersColorScheme",
            "string",
        ),
        # granularOverrides is a JSON array in this engine — see the long note
        # in shell/browser/defaults/preferences/ziy.js. A bare string here
        # throws in FingerprintingWebCompatService and aborts autoconfig.
        "privacy.fingerprintingProtection.granularOverrides": (
            '[{"firstPartyDomain":"*","overrides":"+AllTargets,-CSSPrefersColorScheme"}]',
            "string",
        ),
        # Unmasked WebGL renderer/vendor strings. The engine's real names are
        # webgl.override-unmasked-renderer / -vendor
        # (StaticPrefList.yaml:20403/:20408); the webgl.renderer-string-override
        # / webgl.vendor-string-override names this block used to carry do not
        # exist in the engine, so those locks were no-ops. Do not re-add the old
        # names. See replica/proofs-cpp-privacy.md §2.1.
        "webgl.override-unmasked-renderer": ("Mozilla", "string"),
        "webgl.override-unmasked-vendor": ("Mozilla", "string"),
        "gfx.canvas.serialization.readback": (False, "boolean"),
        "gfx.canvas.hit-region": (False, "boolean"),
        # Signing required is a policy-supported prefix *only because* the
        # patched AppConstants sets MOZ_REQUIRE_SIGNING=false (see
        # Policies.sys.mjs's allowedPrefixes builder). Locking it again here is
        # what makes an unsigned xpi in distribution/extensions/ installable
        # even if some other pref path re-enables the check.
        "xpinstall.signatures.required": (False, "boolean"),
        "xpinstall.whitelist.required": (False, "boolean"),
        "extensions.installDistroAddons": (True, "boolean"),
        "extensions.autoDisableScopes": (0, "number"),
        "extensions.sideloadScopes": (15, "number"),
        "extensions.enabledScopes": (15, "number"),
        # Autoupdate is owned by tools/update-engine.sh; app.update.* is inside
        # the policy allowedPrefixes, so a Mozilla AUS update cannot land and
        # silently revert our patched omni.ja.
        "app.update.auto": (False, "boolean"),
        "app.update.disabledForTesting": (True, "boolean"),
        # Error noise off.
        "browser.chrome.errorReporter.enabled": (False, "boolean"),
        "security.ssl.errorReporting.enabled": (False, "boolean"),
        "security.ssl.errorReporting.automatic": (False, "boolean"),
    }
    for name, (value, kind) in LOCKED_MISC.items():
        prefs[name] = {"Value": value, "Status": "locked", "Type": kind}

    return {
        "policies": {
            "DisableTelemetry": True,
            "DisableFirefoxStudies": True,
            "DisableFirefoxAccounts": True,
            # Error-noise off: no "report this site to Mozilla" menus.
            "DisableFeedbackCommands": True,
            # DNS prefetch off (architecture.md §5.4).
            "NetworkPrediction": False,
            # HTTPS-only mode on and locked: force_enabled.
            "HttpsOnlyMode": "force_enabled",
            # Tracking protection strict, and locked so the user cannot turn
            # it down from the UI (the Shields panel writes per-site overrides
            # through the extensions API, not through this pref).
            "EnableTrackingProtection": {
                "Value": True,
                "Locked": True,
                "Cryptomining": True,
                "Fingerprinting": True,
                "EmailTracking": True,
            },
            # Cookies: reject trackers, expire at session end, locked.
            "Cookies": {
                "Allow": [],
                "AllowSession": [],
                "Block": [],
                "Default": True,
                "AcceptThirdParty": "never",
                "RejectTracker": True,
                "ExpireAtSessionEnd": True,
                "Locked": True,
                "Behavior": "reject-tracker",
                "BehaviorPrivateBrowsing": "reject-tracker",
            },
            # No Mozilla-hosted recommend SURfaces or onboarding.
            "UserMessaging": {
                "WhatsNew": False,
                "ExtensionRecommendations": False,
                "FeatureRecommendations": False,
                "UrlbarInterventions": False,
                "SkipOnboarding": True,
                "MoreFromMozilla": False,
                "FirefoxLabs": False,
                "Locked": True,
            },
            "DisableSetDesktopBackground": True,
            "DisableScreenshots": True,
            "DisableProfileImport": True,
            "DisableAppUpdate": True,
            "ManualAppUpdateOnly": True,
            "DisableRemoteImprovements": True,
            "DisableSystemAddonUpdate": True,
            "CaptivePortal": False,
            "NoDefaultBookmarks": True,
            "DontCheckDefaultBrowser": True,
            "NewTabPage": True,
            "FirefoxHome": {
                "Search": True,
                "TopSites": False,
                "SponsoredTopSites": False,
                "Highlights": False,
                "Pocket": False,
                "SponsoredPocket": False,
                "Snippets": False,
                "Locked": True,
            },
            "OfferToSaveLoginsDefault": False,
            "OfferToSaveLogins": {
                "Allow": False,
                "Locked": True,
            },
            "DisableFormHistory": True,
            # Google is the shipped default engine (co-owner decision), so it
            # must NOT be removed from the engine list here — it is what
            # browser.search.defaultenginename in distribution.ini has to
            # resolve to, and what the welcome page and the NTP picker default
            # to.
            #
            # CORRECTED 2026-10-16: the list here used to include DuckDuckGo.
            # It does not belong: ziy-shell's own first-run catalog offers it
            # (extensions/ziy-shell/ui/welcome.js's ENGINES: google,
            # duckduckgo, startpage, marginalia, custom), so removing it here
            # left the welcome page offering a choice the policy had deleted —
            # the user's pick silently fell back to the default. Keep only the
            # two engines Ziy does not offer anywhere and that carry their own
            # third-party branding into the address bar's one-offs.
            "SearchEngines": {
                "PreventInstalls": False,
                "Default": "Google",
                "DefaultPrivate": "Google",
                "Remove": [
                    "Amazon.com",
                    "eBay",
                ],
            },
            "ExtensionSettings": ext_settings,
            "InstallAddonsPermission": {
                "Allow": [],
                "Default": True,
            },
            "Preferences": prefs,
        }
    }


def validate(doc: dict, schema: dict) -> list[str]:
    """Validate the document against the engine's own schema."""
    try:
        import jsonschema  # type: ignore
    except ImportError:
        try:
            import subprocess
            import sys as _sys

            subprocess.run([_sys.executable, "-m", "pip", "install", "jsonschema", "-q"],
                           check=True)
            import jsonschema  # type: ignore
        except Exception as exc:  # pragma: no cover - environment dependent
            sys.exit(f"policies-gen.py: jsonschema unavailable ({exc}); cannot "
                     "guarantee schema-correctness")
    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    errors = []
    for err in sorted(validator.iter_errors(doc), key=lambda e: list(e.path)):
        errors.append("/".join(str(p) for p in err.path) or "<root>: " + str(err.message))
    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="validate the existing file instead of rewriting it")
    args = ap.parse_args()

    schema, provenance = read_engine_schema()
    if args.check:
        doc = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    else:
        doc = build_policies()

    errors = validate(doc, schema)
    if errors:
        sys.stderr.write("policies-gen.py: policies.json is NOT schema-valid\n")
        for e in errors:
            sys.stderr.write(f"  {e}\n")
        return 1

    if args.check:
        print(f"policies-gen.py: OK — schema-valid against {provenance}")
        return 0

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    OUT_PATH.write_text(text, encoding="utf-8")
    print(f"policies-gen.py: wrote {OUT_PATH} ({len(text)} bytes), "
          f"validated against {provenance}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
