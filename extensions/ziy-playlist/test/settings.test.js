/* Ziy Playlist — settings merge tests.
 *
 * The property under test is self-healing: a stored record that is wrong
 * becomes a working record rather than a broken extension. That is what
 * makes "settings survive a schema change" true rather than aspirational.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const settings = require('../lib/settings.js');

test('the factory record is the documented defaults', () => {
  const f = settings.factorySettings();
  assert.equal(f.defaultSpeed, 1);
  assert.equal(f.sleepTimerMinutes, 0, 'no timer by default');
  assert.equal(f.resumeMode, 'always');
  assert.equal(f.panelSide, 'right');
  assert.equal(f.autoAddPrompt, true);
  assert.equal(f.mediaQuality, 'auto');
});

test('a stored record is merged, not replaced', () => {
  const merged = settings.normaliseSettings({ resumeMode: 'never' });
  assert.equal(merged.resumeMode, 'never');
  assert.equal(merged.defaultSpeed, 1, 'an unset field keeps its default');
});

test('a wrong-shaped value falls back to its default, not to half', () => {
  const merged = settings.normaliseSettings({
    defaultSpeed: 'fast',          // wrong type
    sleepTimerMinutes: -5,         // out of range
    resumeMode: 'sometimes',       // not a mode
    panelSide: 'above',            // not a side
    autoAddPrompt: 'yes',          // not a boolean
    mediaQuality: 'ultra',         // not a quality
  });
  const d = settings.DEFAULTS;
  assert.equal(merged.defaultSpeed, d.defaultSpeed);
  assert.equal(merged.sleepTimerMinutes, d.sleepTimerMinutes);
  assert.equal(merged.resumeMode, d.resumeMode);
  assert.equal(merged.panelSide, d.panelSide);
  assert.equal(merged.autoAddPrompt, d.autoAddPrompt);
  assert.equal(merged.mediaQuality, d.mediaQuality);
});

test('every field is at the engine-facing boundary of its validator', () => {
  assert.equal(settings.normaliseSettings({ defaultSpeed: 0.25 }).defaultSpeed, 0.25);
  assert.equal(settings.normaliseSettings({ defaultSpeed: 4 }).defaultSpeed, 4);
  assert.equal(settings.normaliseSettings({ defaultSpeed: 4.5 }).defaultSpeed,
    settings.DEFAULTS.defaultSpeed, 'past four is refused');
});

test('the offered speed and timer lengths are the ones that merge', () => {
  for (const speed of settings.SPEED_CHOICES) {
    assert.equal(settings.normaliseSettings({ defaultSpeed: speed }).defaultSpeed, speed);
  }
  for (const minutes of settings.SLEEP_CHOICES) {
    assert.equal(settings.normaliseSettings({ sleepTimerMinutes: minutes }).sleepTimerMinutes,
      minutes);
  }
  assert.equal(settings.normaliseSettings({ sleepTimerMinutes: 7 }).sleepTimerMinutes,
    settings.DEFAULTS.sleepTimerMinutes, 'a length nobody offers is not stored');
});

test('a patch is a merge onto the current record', () => {
  const current = settings.normaliseSettings({ resumeMode: 'never', defaultSpeed: 2 });
  const next = settings.patch(current, { resumeMode: 'always' });
  assert.equal(next.resumeMode, 'always');
  assert.equal(next.defaultSpeed, 2, 'the untouched field survives');
  // ...and a patch with nonsense is dropped field by field.
  const guarded = settings.patch(current, { defaultSpeed: 'x' });
  assert.equal(guarded.defaultSpeed, 2, 'a bad value in a patch does not clobber a good one');
});

test('the persisted record is exactly the normalised record', () => {
  const stored = settings.serialiseSettings({ resumeMode: 'ask' });
  assert.deepEqual(stored, settings.normaliseSettings(stored));
  // A round trip through JSON cannot change it.
  assert.deepEqual(settings.normaliseSettings(JSON.parse(JSON.stringify(stored))), stored);
});

/* --------------------------------------------------------------------- */
/* Per-site dismissals                                                     */
/* --------------------------------------------------------------------- */

test('a dismissal is keyed by origin and bounded', () => {
  let sites = settings.dismissSite({}, 'https://site.test');
  assert.equal(settings.isSiteDismissed(sites, 'https://site.test'), true);
  assert.equal(settings.isSiteDismissed(sites, 'https://other.test'), false);
  assert.equal(settings.isSiteDismissed(sites, null), false, 'a null origin is never dismissed');
});

test('a dismissal survives a JSON round trip, which is how it is stored', () => {
  const sites = settings.dismissSite({}, 'https://site.test');
  const stored = JSON.parse(JSON.stringify(sites));
  assert.equal(settings.isSiteDismissed(stored, 'https://site.test'), true);
});

test('the dismissal list is capped so it cannot grow forever', () => {
  let sites = {};
  for (let i = 0; i < 260; i += 1) {
    sites = settings.dismissSite(sites, 'https://site' + i + '.test');
  }
  assert.ok(Object.keys(sites).length <= 200, 'the list is bounded, saw ' + Object.keys(sites).length);
});

test('un-dismissing removes exactly one origin', () => {
  let sites = settings.dismissSite({}, 'https://a.test');
  sites = settings.dismissSite(sites, 'https://b.test');
  sites = settings.undismissSite(sites, 'https://a.test');
  assert.equal(settings.isSiteDismissed(sites, 'https://a.test'), false);
  assert.equal(settings.isSiteDismissed(sites, 'https://b.test'), true);
});

test('a non-origin key in a stored dismissal is dropped', () => {
  const sites = settings.normaliseSites({ 'not-a-url': true, 'javascript:alert(1)': true });
  assert.deepEqual(sites, {});
});
