/**
 * The CSV password format, in and out.
 *
 * WHAT SHAPE, AND WHO DOCUMENTED IT
 * ---------------------------------
 * replica/recon.md's S49 row is Brave's password manager: "save prompt bubble,
 * list, export/import CSV, settings" with the empty/populated/import states. The
 * CSV is the Netscape-CSV shape every browser writes and reads, which is the
 * same family of "the format is the interoperability" logic that
 * extensions/ziy-desktop/lib/bookmarks.js already implements for bookmarks
 * ("The Netscape format is the one every browser writes and reads", recorded in
 * replica/proofs-desktop.md §2.1).
 *
 * Columns, in the order Chrome/Brave write them:
 *   name,url,username,password
 * and a one-line header. Notes: the CRLF line endings, the RFC 4180 quoting
 * rules (a field containing a comma, a quote or a newline is quoted, and a
 * quote inside is doubled), and the fact that a password may contain any of
 * those.
 *
 * WHAT IS DONE HERE, AND WHAT IS NOT
 * ----------------------------------
 * Read and write only. There is no attempt to recognise Chrome's "note" column
 * or Firefox's exported variants beyond the header mapping, and the importer is
 * deliberately strict about the first line: a file with no recognisable header
 * is rejected rather than guessed at, because importing a bookmark export as
 * passwords would produce nonsense entries that are hard to find and delete.
 */

/** The header the importer understands, lowercased and trimmed. */
const KNOWN_HEADERS = ["name", "url", "username", "password"];

/**
 * Parses CSV text into rows of fields, honouring RFC 4180 quoting.
 * Returns null when the file is not a CSV this importer accepts.
 *
 * @param {string} text
 * @returns {{header: string[], rows: string[][]}|null}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const src = String(text || "");
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return null;

  const header = rows[0].map(h => String(h || "").trim().toLowerCase());
  if (!header.length) return null;
  // The header must carry at least url, username and password: a file without
  // them is not a password export, and importing it as one would be wrong.
  for (const needed of ["url", "username", "password"]) {
    if (!header.includes(needed)) return null;
  }
  return { header, rows: rows.slice(1).filter(r => r.some(c => c !== "")) };
}

/**
 * Builds credentials from parsed CSV. The column lookup is by header name, so
 * an export whose columns are in a different order still imports.
 *
 * @returns {{credentials: Array<{name: string, origin: string, username: string, password: string}>, skipped: number}}
 */
export function credentialsFromCsv(text) {
  const parsed = parseCsv(text);
  if (!parsed) return { credentials: [], skipped: 0, error: "not a password CSV" };
  const at = (row, name) => {
    const idx = parsed.header.indexOf(name);
    return idx < 0 ? "" : String(row[idx] ?? "");
  };
  const credentials = [];
  let skipped = 0;
  for (const row of parsed.rows) {
    const origin = at(row, "url").trim();
    const username = at(row, "username").trim();
    const password = at(row, "password");
    const name = at(row, "name").trim();
    // A row with no origin or no password cannot be filled, so it is counted
    // as skipped rather than stored: an unimportable row is not a silent
    // failure the user discovers at the next fill.
    if (!origin || !password) { skipped++; continue; }
    credentials.push({ name, origin, username, password });
  }
  return { credentials, skipped, error: null };
}

/** RFC 4180 escaping: quote when the field contains a comma, quote or newline. */
function escapeField(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Writes the CSV a browser can read back: the header, then one row per
 * credential, CRLF line endings, in the Chrome/Brave column order. Round-trips
 * through credentialsFromCsv unchanged.
 *
 * @param {Array<{name?: string, origin: string, username: string, password: string}>} credentials
 * @returns {string}
 */
export function toCsv(credentials) {
  const lines = [KNOWN_HEADERS.join(",")];
  for (const c of credentials || []) {
    lines.push([
      escapeField(c.name || ""),
      escapeField(c.origin || ""),
      escapeField(c.username || ""),
      escapeField(c.password || ""),
    ].join(","));
  }
  // CRLF, as Chrome and Brave write it.
  return lines.join("\r\n") + "\r\n";
}
