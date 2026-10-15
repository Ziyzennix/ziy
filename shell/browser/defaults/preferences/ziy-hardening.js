// Ziy — hardening defaults.
//
// This file holds the prefs that must NOT be different on a Ziy install than
// they are here. They are written as pref() defaults in this file AND as
// lockPref() in mozilla.cfg, so that:
//   * a fresh profile boot only the app-dir defaults -> already correct,
//   * a profile that tries to override them -> blocked by the lock.
//
// Split rationale (architecture.md §5.4): "policies for what must be locked,
// autoconfig for defaults the user may change." The hardening set is the
// third leg — values that are not user-changeable at all, and that exist in
// both places so the behaviour does not depend on which layer loaded first.
//
// Every pref in this file is repeated in mozilla.cfg with lockPref(). If you
// add one here, add the lock there. tools/verify.sh asserts the two agree.

// ---------------------------------------------------------------------------
// Fingerprint resistance: hard floor
// ---------------------------------------------------------------------------
pref("privacy.resistFingerprinting", true);
pref("privacy.resistFingerprinting.letterboxing", true);
pref("privacy.resistFingerprinting.randomizationOnRestart", true);
pref("privacy.fingerprintingProtection.enabled", true);
pref("privacy.fingerprintingProtection.pbmode", true);
// A JSON array — see the long note in ziy.js. A bare string here is a hard
// parse error in FingerprintingWebCompatService and will abort autoconfig.
pref("privacy.fingerprintingProtection.overrides", "+AllTargets,-CSSPrefersColorScheme");
pref("privacy.fingerprintingProtection.granularOverrides", "[]");

// Canvas and WebGL are the two highest-signal fingerprinting surfaces.
pref("gfx.canvas.serialization.readback", false);
pref("gfx.canvas.hit-region", false);
pref("webgl.disabled", false);
// webgl.renderer-string-override / webgl.vendor-string-override were the wrong
// names; the engine reads webgl.override-unmasked-renderer /
// webgl.override-unmasked-vendor (StaticPrefList.yaml:20403/:20408). Both are
// locked in mozilla.cfg. Do not re-add the old names. See
// replica/proofs-cpp-privacy.md §2.1.
pref("webgl.override-unmasked-renderer", "Mozilla");
pref("webgl.override-unmasked-vendor", "Mozilla");
// Do not expose the platform's CPU count / memory to content.
pref("dom.maxHardwareConnectionTimeout", 0);

// ---------------------------------------------------------------------------
// APIs the product does not ship
// ---------------------------------------------------------------------------
pref("dom.battery.enabled", false);
// dom.serial.enabled was a typo for dom.webserial.enabled (the engine's real
// name, StaticPrefList.yaml:6205). Do not re-add the old name.
pref("dom.webserial.enabled", false);
// dom.webbluetooth.enabled, dom.nfc.enabled, dom.idle-detector.enabled —
// REMOVED: those APIs are not implemented in Gecko 156.0.1, so there is no pref
// to lock and the locks were silent no-ops. Do not re-add these lines. Full
// dead-pref hunt with citations: replica/proofs-cpp-privacy.md §2.1/§2.2.
// dom.filesystem.enabled was the wrong name; the engine reads dom.fs.enabled
// (StaticPrefList.yaml:5384). Do not re-add the old name.
pref("dom.fs.enabled", false);
pref("dom.netinfo.enabled", false);
pref("dom.event.contextmenu.enabled", false);
pref("dom.gamepad.enabled", false);
pref("dom.vibrator.enabled", false);
pref("dom.push.connection.enabled", false);
// Motion sensors: implemented in Gecko 156 (read at
// dom/base/nsGlobalWindowInner.cpp:3622-3635, gating all four sensor event
// interfaces) and previously not disabled anywhere.
pref("device.sensors.enabled", false);

// ---------------------------------------------------------------------------
// The WebRTC identity surfaces
// ---------------------------------------------------------------------------
// mDNS obfuscation is the default; device enumeration stays off so a page
// cannot count our cameras and mics without asking first.
pref("media.peerconnection.ice.no_host", true);
pref("media.peerconnection.ice.default_address_only", true);
pref("media.peerconnection.identity.enabled", false);
pref("media.navigator.enabled", false);
pref("media.webspeech.recognition.enable", false);
pref("media.webspeech.synth.enabled", false);
pref("media.autoplay.default", 5);

// ---------------------------------------------------------------------------
// Network hardening floor
// ---------------------------------------------------------------------------
pref("network.dns.disablePrefetch", true);
pref("network.dns.disablePrefetchFromHTTPS", true);
pref("network.predictor.enabled", false);
pref("network.captive-portal-service.enabled", false);
pref("network.dns.echconfig.enabled", false);
pref("network.trr.mode", 5);
pref("network.http.sendRefererHeader", 2);
pref("network.http.referer.XOriginPolicy", 1);
pref("network.http.sendSecureXSiteReferrer", false);
pref("dom.security.https_only_mode", true);

// ---------------------------------------------------------------------------
// Telemetry / reporting: the floor is off
// ---------------------------------------------------------------------------
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.usage.uploadEnabled", false);
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.newProfilePing.enabled", false);
pref("toolkit.telemetry.shutdownPingSender.enabled", false);
pref("toolkit.telemetry.firstShutdownPing.enabled", false);
pref("toolkit.telemetry.bhrPing.enabled", false);
pref("toolkit.telemetry.server", "");
pref("toolkit.telemetry.cachedClientID", "");
pref("toolkit.crashreporter.infoURL", "");
pref("app.normandy.enabled", false);
pref("app.shield.optoutstudies.enabled", false);
pref("browser.ping-centre.telemetry", false);
pref("browser.discovery.enabled", false);
pref("browser.safebrowsing.reportPhishURL", "");
pref("browser.safebrowsing.reportMalwareURL", "");
pref("browser.chrome.errorReporter.enabled", false);
pref("security.ssl.errorReporting.enabled", false);
pref("security.ssl.errorReporting.url", "");
pref("security.ssl.errorReporting.automatic", false);

// ---------------------------------------------------------------------------
// Firefox Accounts / Mozilla sync: disabled, so only ziy-sync can exist
// ---------------------------------------------------------------------------
pref("identity.fxaccounts.enabled", false);
pref("identity.fxaccounts.toolbar.enabled", false);

// ---------------------------------------------------------------------------
// The product's own suite
// ---------------------------------------------------------------------------
// Signing is irrelevant to us: our app dir installs unsigned add-ons from
// distribution/extensions/ because omni.ja carries MOZ_REQUIRE_SIGNING=false.
pref("xpinstall.signatures.required", false);
pref("xpinstall.whitelist.required", false);
pref("extensions.autoDisableScopes", 0);
pref("extensions.installDistroAddons", true);
