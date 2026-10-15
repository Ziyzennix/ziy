// Ziy — default preferences for the whole product.
//
// Load order at startup (all verified on this box, see replica/proofs-shell.md):
//   defaults/pref/channel-prefs.js      (GRE root, app.update.channel)
//   browser/defaults/preferences/*.js   (this file and ziy-hardening.js)
//   mozilla.cfg                         (autoconfig: defaultPref/lockPref)
//   distribution/distribution.ini       (partner prefs)
//   distribution/policies.json          (policies engine)
//   user.js / prefs.js                  (the profile)
//
// Rule of thumb used in this file, taken from architecture.md §5.4:
//   * values the USER may change  -> pref() here            (a default)
//   * values that must be locked   -> lockPref() in mozilla.cfg
//   * enterprise-shaped settings   -> distribution/policies.json
//
// Nothing in this file is a security boundary on its own; the boundaries live
// in mozilla.cfg and policies.json.

// ---------------------------------------------------------------------------
// 1. Autoconfig (the mozilla.cfg callfile mechanism)
// ---------------------------------------------------------------------------
// general.config.filename names the config file at the GRE root, and
// obscure_value must be 0 so the file is plain text rather than ROT13. Both
// prefs are registered by libxul (they appear as standalone strings in
// libxul.so) and the mechanism itself lives in nsAutoConfig, which is present
// in this release build: omni.ja ships defaults/autoconfig/prefcalls.js which
// is where the defaultPref/lockPref helpers we call from mozilla.cfg come from.
//
// NOTE ON HASHING: `general.config.sha256` is NOT a preference Firefox
// implements on this box. The full list of general.config.* prefs registered by
// libxul is general.config.filename, general.config.obscure_value,
// general.config.sandbox_enabled and general.config.vendor — verified with
// `strings -a /usr/lib/firefox/libxul.so | grep '^general\.config'`. There is
// no hash-verification pref to set, so mozilla.cfg is referenced by filename
// only, exactly as the standard mechanism describes. The file is shipped
// inside our own app dir, which is the trust boundary we control.

pref("general.config.obscure_value", 0);
pref("general.config.filename", "mozilla.cfg");

// Keep the autoconfig sandbox tight: mozilla.cfg gets no DOM or Xray-less
// access to anything beyond the pref API and getenv().
pref("general.config.sandbox_enabled", true);

// ---------------------------------------------------------------------------
// 2. Ziy identity
// ---------------------------------------------------------------------------
// Read by our shell extension and by the launcher when it wants to know if the
// app dir it is running matches the shell layer it was built from.
pref("ziy.app.name", "Ziy");
pref("ziy.app.version", "156.0.1");
pref("ziy.shell.profile", "default");

// ---------------------------------------------------------------------------
// 3. Branding / first-run (architecture.md §6.2, recon S01)
// ---------------------------------------------------------------------------
// We do not show Mozilla's welcome tour: ziy-shell owns the first-run
// experience (S01). about:welcome would otherwise render Mozilla's cards.
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_override_url", "");
// The new tab page is owned by extensions/ziy-ntp via chrome_url_overrides.
// Keep Firefox's own activity-stream home page from racing it on startup.
pref("browser.startup.homepage", "about:newtab");
pref("browser.startup.page", 1);

// ---------------------------------------------------------------------------
// 4. Tracking protection & cookies
// ---------------------------------------------------------------------------
// Enhanced Tracking Protection, strict in normal windows. Values: 0=off,
// 1=allow-list, 2=standard, 3=strict. `5` would be custom; we stay on strict so
// the Shields panel's global default (recon S10 "factory defaults") is honest.
pref("privacy.trackingprotection.enabled", true);
pref("privacy.trackingprotection.pbmode.enabled", true);
pref("privacy.trackingprotection.cryptomining.enabled", true);
pref("privacy.trackingprotection.fingerprinting.enabled", true);
pref("privacy.trackingprotection.emailtracking.enabled", true);
pref("privacy.trackingprotection.socialtracking.enabled", true);
pref("privacy.trackingprotection.allow_list.baseline.enabled", true);
pref("privacy.trackingprotection.allow_list.convenience.enabled", true);
// Level 3 = strict. Locked in policies.json via EnableTrackingProtection.
pref("browser.contentblocking.category", "strict");

// Cookie behaviour: reject trackers and third-party cookies, clear on close.
// network.cookie.cookieBehavior: 0=all, 1=none-third-party, 2=none-trackers,
// 3=tracker+partition, 4=all-trackers-partition, 5=all-storage-partition.
pref("network.cookie.cookieBehavior", 5);
// network.cookie.lifetimePolicy / .lifetime.days — REMOVED: no such pref exists
// in the engine (0 occurrences in StaticPrefList.yaml and all.js). Setting it was
// a no-op, so the "clear cookies after 7 days" intent was never in force. The
// engine's real cookie-age control is network.cookie.maxageCap; do not re-add
// `network.cookie.lifetimePolicy` here.
// privacy.partition.network_state.ocsp_cache / .cookie_cache and
// privacy.partition.serviceWorkers — REMOVED: none of the three exist in the
// engine (only privacy.partition.bloburl_per_partition_key and
// privacy.partition.network_state.connection_with_proxy do, StaticPrefList.yaml
// :18269/:18281). Do not re-add them. The partitioning they intended is already
// enforced by network.cookie.cookieBehavior=5 above. Full dead-pref hunt:
// replica/proofs-cpp-privacy.md §2.5.
pref("privacy.document_resource.origin_attrs.enabled", true);

// ---------------------------------------------------------------------------
// 5. HTTPS-only mode & referrer capping
// ---------------------------------------------------------------------------
// HTTPS-Only Mode on, upgrade every HTTP scheme we can.
pref("dom.security.https_only_mode", true);
pref("dom.security.https_only_mode.upgrade_local", true);
pref("dom.security.https_first", true);

// Referrer policy: 2 = strict-origin-when-cross-origin, i.e. we send a full
// referrer only same-origin and only the origin cross-origin.
pref("network.http.sendRefererHeader", 2);
pref("network.http.referer.XOriginPolicy", 1);

// ---------------------------------------------------------------------------
// 6. Fingerprint resistance (recon S08 "Block fingerprinting")
// ---------------------------------------------------------------------------
// Gecko's own resistFingerprinting, plus the per-target overrides the Shields
// panel writes per site. The target names are the ones in RFPTargets.inc.
// The list syntax is "+AllTargets,-CSSPrefersColorScheme", meaning "enable every
// target except the colour-scheme one".
//
// NOTE ON THE TWO OVERRIDE PREFS — verified against the engine's own source on
// 2026-10-14 (modules/FingerprintingWebCompatService.sys.mjs inside omni.ja):
//
//   privacy.resistFingerprinting
//       boolean, locks the whole RFP service on.
//   privacy.fingerprintingProtection.overrides
//       a RFP target STRING, e.g. "+AllTargets,-CSSPrefersColorScheme".
//   privacy.fingerprintingProtection.granularOverrides
//       a JSON ARRAY of objects, each with the shape
//         {"firstPartyDomain": "<domain or *>", "overrides": "<target string>"}
//       The service does `JSON.parse(pref || "[]")` and validates every entry
//       against a JSON-schema, so a bare string in this pref is a hard parse
//       error: the prefs service refuses to set it, and — this is the part that
//       cost real debugging time — a lockPref() of a pref the service rejects
//       aborts autoconfig mid-file, which leaves the engine half-configured and
//       is what produced the "RenderCompositorSWGL failed mapping default
//       framebuffer" crash and the silent startup hang in early builds.
//
// So: the target string goes in `.overrides`; the per-site JSON array goes in
// `.granularOverrides`. tools/verify.sh asserts both parse.
pref("privacy.resistFingerprinting", true);
pref("privacy.resistFingerprinting.letterboxing", true);
pref("privacy.resistFingerprinting.pbmode", true);
pref("privacy.resistFingerprinting.randomizationOnRestart", true);
pref("privacy.resistFingerprinting.exemptedDomains", "");
pref("privacy.fingerprintingProtection.enabled", true);
pref("privacy.fingerprintingProtection.pbmode", true);
// The RFP target string (this is the one that takes a bare string).
pref("privacy.fingerprintingProtection.overrides", "+AllTargets,-CSSPrefersColorScheme");
// The per-site JSON array. Empty array = no per-site overrides yet; the Shields
// panel writes {firstPartyDomain, overrides} entries here.
pref("privacy.fingerprintingProtection.granularOverrides", "[]");

// ---------------------------------------------------------------------------
// 7. Disabled web APIs (recon S23 hardening list from architecture.md §5.4)
// ---------------------------------------------------------------------------
// These are the APIs Brave removes from the platform entirely. On Gecko each
// one is a dom.* switch. policy Preferences in policies.json locks them; these
// are the user-visible defaults.
pref("dom.battery.enabled", false);
// dom.serial.enabled was a typo for the engine's real name dom.webserial.enabled
// (StaticPrefList.yaml:6205, Navigator.webidl:254). Do not re-add the old name.
// Full dead-pref hunt: replica/proofs-cpp-privacy.md §2.1.
pref("dom.webserial.enabled", false);
// dom.webbluetooth.enabled, dom.nfc.enabled, dom.idle-detector.enabled —
// REMOVED: those APIs are not implemented in Gecko 156.0.1 (no Bluetooth*/NDEF/
// IdleDetector interface in dom/webidl/), so setting the prefs was a no-op and
// there is nothing to disable. Do not re-add these lines. Full dead-pref hunt
// with citations: replica/proofs-cpp-privacy.md §2.1/§2.2.
// dom.filesystem.enabled was the wrong name; the engine reads dom.fs.enabled
// (StaticPrefList.yaml:5384). Do not re-add the old name.
pref("dom.fs.enabled", false);
pref("dom.netinfo.enabled", false);
// Remove the site context menu (a Brave-style "no curated menu from the
// platform" default). Brave shows its own.
pref("dom.event.contextmenu.enabled", false);
pref("dom.gamepad.enabled", false);
pref("dom.vibrator.enabled", false);
// dom.security.featurePolicy.enabled — REMOVED: the engine has no pref by that
// bare name; it registers only .header, .experimental and .webidl variants
// (StaticPrefList.yaml:4942 for the .webidl one). Do not re-add the bare name.
// Motion sensors: the one recon-listed device API that IS implemented in Gecko
// 156 and was not disabled anywhere. Read at
// dom/base/nsGlobalWindowInner.cpp:3622-3635, gating all four sensor event
// interfaces at once.
pref("device.sensors.enabled", false);
pref("dom.push.connection.enabled", false);

// ---------------------------------------------------------------------------
// 8. Telemetry, Normandy, studies, crash pings — all off by default
// ---------------------------------------------------------------------------
// The policy engine locks these (DisableTelemetry / DisableFirefoxStudies /
// DisableRemoteImprovements in policies.json). The pref defaults below exist
// so that a profile that somehow imports a Mozilla default still starts dark.
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.policy.firstRunTime", 0);
pref("datareporting.usage.uploadEnabled", false);
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.server", "");
pref("toolkit.telemetry.cachedClientID", "");
pref("toolkit.telemetry.newProfilePing.enabled", false);
pref("toolkit.telemetry.shutdownPingSender.enabled", false);
pref("toolkit.telemetry.firstShutdownPing.enabled", false);
pref("toolkit.telemetry.bhrPing.enabled", false);
pref("toolkit.telemetry.reportingpolicy.firstRun", false);
pref("app.normandy.enabled", false);
pref("app.normandy.first-run", false);
pref("app.shield.optoutstudies.enabled", false);
pref("browser.ping-centre.telemetry", false);
pref("browser.discovery.enabled", false);
pref("browser.topsites.contile.enabled", false);
pref("browser.topsites.sponsoredShortcuts.enabled", false);
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.feeds.snippets", false);
pref("browser.newtabpage.activity-stream.asrouter.providers.snippets", "");
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
// The engine's OWN new tab is the built-in add-on newtab@mozilla.org, and it is
// the only other chrome_url_overrides.newtab claimant in the product. Two
// switches kill it at the pref layer, before the add-on layer is even reached:
//   browser.newtabpage.enabled=false makes
//   AboutNewTabRedirector.sys.mjs route about:newtab to the EXTENSION override
//   instead of the built-in page, and
//   browser.newtabpage.disableNewTabAsAddon=true (read once per session by
//   AboutNewTabResourceMapping.sys.mjs) stops the built-in add-on's resources
//   from being mapped at all, in favour of the extension's.
// The omni.ja patch in build-shell.sh (§7b) makes the built-in add-on itself
// uninstallable, so the new tab page is ours in BOTH layers, and either layer
// alone is already enough: the pref layer is the honest default, the byte
// patch is the hard backstop.
pref("browser.newtabpage.enabled", false);
pref("browser.newtabpage.disableNewTabAsAddon", true);
// No train-hopping, no about:home cache, no activity-stream self-loading: the
// engine's own newtab machinery is fully off, not partially.
pref("browser.newtabpage.activity-stream.selfLoading.enabled", false);
pref("browser.startup.homepage.abouthome_cache.enabled", false);

// ---------------------------------------------------------------------------
// 9. Network-level privacy
// ---------------------------------------------------------------------------
// DNS prefetch is off (architecture.md §5.4, NetworkPrediction policy).
pref("network.dns.disablePrefetch", true);
pref("network.dns.disablePrefetchFromHTTPS", true);
pref("network.prefetch-next", false);
pref("network.predictor.enabled", false);
pref("network.http.speculative-parallel-limit", 0);
// No captive portal probing out of the box.
pref("network.captive-portal-service.enabled", false);
// Safe Browsing is a Brave-side no-brainer to keep, but we do not need its
// occasional hash-ping; the local lookup stays enabled and the "report this
// site" paths are off.
pref("browser.safebrowsing.malware.enabled", true);
pref("browser.safebrowsing.phishing.enabled", true);
pref("browser.safebrowsing.downloads.enabled", true);
pref("browser.safebrowsing.blockedURIs.enabled", false);
pref("browser.safebrowsing.reportPhishURL", "");
pref("browser.safebrowsing.reportMalwareURL", "");
pref("browser.safebrowsing.provider.mozilla.gethashURL", "");
pref("browser.safebrowsing.provider.mozilla.updateURL", "");
// Encrypted Client Hello hides SNI; leave the mechanism available but do not
// force it on.
pref("network.dns.echconfig.enabled", false);
// DNS over HTTPS off by default (Ziy sync brings its own secure transport).
pref("network.trr.mode", 5);

// ---------------------------------------------------------------------------
// 10. Firefox Accounts / Sync disabled (only ziy-sync exists)
// ---------------------------------------------------------------------------
// The DisableFirefoxAccounts policy locks these; these are the defaults.
pref("identity.fxaccounts.enabled", false);
pref("identity.fxaccounts.toolbar.enabled", false);
pref("identity.fxaccounts.sync.devices.url", "");
pref("services.sync.engine.prefs", false);
pref("services.sync.username", "");
pref("services.sync.accounts", "");
pref("identity.mobilepromo.android", "");

// ---------------------------------------------------------------------------
// 11. Error noise: no "report this site to Mozilla" prompts
// ---------------------------------------------------------------------------
pref("browser.chrome.errorReporter.enabled", false);
pref("browser.chrome.favicons", false);
pref("datareporting.sessions.current.clean", true);
pref("security.ssl.errorReporting.enabled", false);
pref("security.ssl.errorReporting.url", "");

// Pocket is Mozilla's, not ours.
pref("extensions.pocket.enabled", false);
pref("extensions.pocket.api", "");
pref("extensions.pocket.oAuthConsumerKey", "");
pref("extensions.pocket.siteURL", "");

// ---------------------------------------------------------------------------
// 12. Extension suite settings
// ---------------------------------------------------------------------------
// The suite ids that our app dir installs from distribution/extensions/. The
// ids are ALSO declared in policies.json ExtensionSettings, which is what locks
// them; this is the plain default layer.
pref("extensions.autoDisableScopes", 0);
pref("extensions.sideloadScopes", 15);
pref("extensions.installDistroAddons", true);
pref("extensions.legacy.enabled", true);
pref("xpinstall.signatures.required", false);
pref("xpinstall.whitelist.required", false);
pref("extensions.allowPrivateBrowsingByDefault", true);
// We are the app dir, so our distribution addons install with the app scope
// rather than the profile scope.
pref("extensions.enabledScopes", 15);

// ---------------------------------------------------------------------------
// 13. Shell UI defaults (recon S22 Appearance / S06 tab strip)
// ---------------------------------------------------------------------------
// These are the values the design system will read before the shell extension
// has written its own settings, so a first launch is already branded.
pref("browser.tabs.inTitlebar", 1);
pref("browser.tabs.drawInTitlebar", true);
pref("browser.uidensity", 0);
pref("browser.toolbars.bookmarks.visibility", "always");
pref("browser.theme.content-theme", 0);
pref("browser.theme.dark-private-windows", true);
pref("extensions.activeThemeID", "ziy-shell@ziy.app");
// Sidebar: show it, on the right, because ziy-playlist
// are sidebar_action extensions and a hidden rail would make them unusable.
pref("sidebar.revamp", true);
pref("sidebar.verticalTabs", false);
pref("sidebar.position_start", false);
pref("sidebar.visibility", "always");
pref("browser.ml.chat.enabled", false);
pref("browser.ml.chat.menu", false);
pref("browser.ml.linkPreview.enabled", false);
pref("browser.ai.control.sidebarChatbot", false);
// Firefox's built-in translation: our own UI owns this decision later.
pref("browser.translations.enable", false);

// ---------------------------------------------------------------------------
// 14. Downloads / passwords — sane, user-changeable defaults
// ---------------------------------------------------------------------------
pref("browser.download.useDownloadDir", true);
pref("browser.download.alwaysOpenPanel", true);
pref("browser.download.manager.addToRecentDocs", true);
pref("browser.download.start_downloads_in_tmp_dir", false);
pref("signon.rememberSignons", true);
pref("signon.generation.enabled", true);
pref("signon.autofillForms", true);
pref("signon.storeWhenAutocompleteOff", false);
pref("browser.formfill.enable", false);
pref("browser.urlbar.speculativeConnect.enabled", false);
pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
pref("browser.urlbar.suggest.searches", false);
pref("browser.urlbar.trimURLs", false);
pref("keyword.enabled", false);

// ---------------------------------------------------------------------------
// 15. Ziy-only feature flags, read by the extension suite
// ---------------------------------------------------------------------------
// The suite reads these through the shared settings bus (architecture.md §3.1
// `settings.*`). They live here so a freshly bootstrapped profile has the same
// starting state the suite expects.
pref("ziy.shields.enabled", true);
pref("ziy.shields.lists.default", "ziy-default");
pref("ziy.shields.counts.resetOnNavigation", true);
pref("ziy.ntp.widgets.background", true);
pref("ziy.ntp.widgets.search", true);
pref("ziy.ntp.widgets.topsites", true);
pref("ziy.ntp.widgets.clock", "24");
pref("ziy.ntp.widgets.stats", true);
pref("ziy.ntp.widgets.news", false);
pref("ziy.sync.enabled", false);
pref("ziy.profile.autocreate", true);
