/* Ziy shields — the blocked-item counter, shaped to the observed product.
 *
 * replica/recon-behavior.md records what the installed Brave actually shows in
 * its stats widget:
 *
 *   STATS / 2 Trackers & ads blocked / 0 kB Bandwidth saved / 0 seconds Time saved
 *
 * three things that this counter mirrors rather than invents:
 *
 *  1. ONE combined "Trackers & ads" number, not separate ads and trackers
 *     rows — the source has no ads/trackers split in the counter (there is one
 *     `BRAVE_ADS`/`BRAVE_TRACKERS` control behind the row).
 *  2. Units are kB and seconds, not items and bytes.
 *  3. The wording is Ziy's own; the observed string is not reused.
 *
 * Counting still resets on navigation (recon S09), and the per-item list keeps
 * each URL so the panel's count link can open the list. The derived figures are
 * estimates and are labelled as such in the UI: kB saved is the sum of the
 * Content-Length of the blocked responses when the header was observed, and
 * seconds saved is a documented per-request estimate (a blocked subresource does
 * not need parsing), so neither is presented as an exact measurement.
 */

/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md §2)
 *
 * This file is loaded as a classic <script> in the shared global scope of
 * the event page, next to the other ziy-shields lib files. It therefore
 * declares NOTHING at the top level: the whole body lives inside the
 * factory below. A second top-level declaration of a name another file
 * already owns is a PARSE-time SyntaxError in that scope ("redeclaration
 * of non-configurable global property"), the engine discards the whole
 * file, and every listener in it fails to register — which is precisely
 * defect D-2 in replica/test-report.md. The API is published on the one
 * `ziyShields` namespace this extension shares, and on module.exports
 * under node --test.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  if (!root.ziyShields) root.ziyShields = {};
  const api = factory();
  Object.assign(root.ziyShields, api);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.TabCounter = api.TabCounter;
    exports.SECONDS_PER_REQUEST_ESTIMATE = api.SECONDS_PER_REQUEST_ESTIMATE;
    exports.formatKilobytes = api.formatKilobytes;
    exports.formatSeconds = api.formatSeconds;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

'use strict';

/**
 * A single blocked item, as the recon's BlockedItemLog describes it.
 *
 * @typedef {object} BlockedItem
 * @property {number} at            epoch ms
 * @property {'ad'|'tracker'|'script'|'fingerprinting'|'upgrade'} category
 * @property {string} url           the request URL that was stopped
 * @property {string} tier          which engine tier stopped it
 * @property {string} [protocol]    resource type
 * @property {string} [initiator]   the document URL
 * @property {number} [bytes]       Content-Length when observed
 */

/** A deliberately conservative per-request time estimate, in seconds.
 *  It exists so the "time saved" figure is a stated model rather than a number
 *  the product appears to have measured. A blocked subresource saves its fetch,
 *  parse and script execution; 30ms is a floor for a small subresource. */
const SECONDS_PER_REQUEST_ESTIMATE = 0.03;

/**
 * The per-tab counter. Counts reset on navigation — that is the §5.3 rule the
 * recon is explicit about, so this is session state keyed by tab id and never
 * persisted.
 */
class TabCounter {
  constructor() {
    this.blocks = 0;
    this.upgrades = 0;
    this.bytes = 0;
    this.categories = Object.create(null);
    this.items = [];
    this.startedAt = Date.now();
    this.domain = null;
  }

  reset(domain) {
    this.blocks = 0;
    this.upgrades = 0;
    this.bytes = 0;
    this.categories = Object.create(null);
    this.items = [];
    this.startedAt = Date.now();
    if (domain !== undefined) this.domain = domain;
  }

  record(item) {
    this.blocks++;
    const category = item.category || 'tracker';
    this.categories[category] = (this.categories[category] || 0) + 1;
    if (typeof item.bytes === 'number' && item.bytes > 0) this.bytes += item.bytes;
    // The list is for the panel, not a log: keep the first 200 so a page with
    // thousands of subresources cannot grow the counter without bound.
    if (this.items.length < 200) this.items.push(item);
    return this;
  }

  recordUpgrade(url) {
    this.upgrades++;
    if (this.items.length < 200) {
      this.items.push({ at: Date.now(), category: 'upgrade', url });
    }
    return this;
  }

  /**
   * The three figures the panel shows, in the observed product's shape.
   * @returns {{combined: number, kilobytesSaved: number, secondsSaved: number, byCategory: object}}
   */
  stats() {
    return {
      // ONE number: ads and trackers together, matching the observed widget.
      combined: this.blocks,
      kilobytesSaved: this.bytes / 1024,
      secondsSaved: this.blocks * SECONDS_PER_REQUEST_ESTIMATE,
      byCategory: { ...this.categories },
      upgrades: this.upgrades,
    };
  }

  /** The panel's count sentence, in Ziy's own words. */
  sentence() {
    const s = this.stats();
    if (s.combined === 0) return 'Nothing stopped this visit';
    const n = s.combined;
    const word = n === 1 ? 'request' : 'requests';
    return `${n} ${word} stopped this visit`;
  }
}

function formatKilobytes(kb) {
  if (kb < 1024) return `${Math.round(kb)} kB`;
  return `${(kb / 1024).toFixed(kb / 1024 < 10 ? 1 : 0)} MB`;
}

function formatSeconds(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

  return {
    TabCounter,
    SECONDS_PER_REQUEST_ESTIMATE,
    formatKilobytes,
    formatSeconds,
  };
});
