# Ziy components

25 components from `replica/recon.md`, plus the browser-chrome pieces `replica/architecture.md`
says we own via `userChrome.css` / the app dir (tab strip, toolbar, find bar, sidebar rail, NTP).
Every value is a token from `replica/design/tokens.css`; no raw hex in components.

Conventions used in every block:

- **focus-visible** is always `2px solid var(--focus)` + `2px` offset. Never `outline: none`
  without a replacement that meets 3:1 against the surrounding background.
- **disabled** is `aria-disabled="true"` for elements that must stay focusable (rows,
  nav items, list actions) and the native `disabled` attribute for real form controls.
  Disabled never removes the element from the tab order when its removal would lose
  context; the element stays reachable and announces why it is inert.
- **loading** keeps the accessible name; the spinner is `aria-hidden`.
- **error** state always pairs a visible message (`role="alert"` or `aria-live="polite"`)
  with a token colour change; colour alone never carries the message.
- **keyboard** lists every path, including the ones the reference only supported with a mouse.
- Screen-reader names are Ziy-voiced and written here explicitly; the build must not
  paraphrase them.

---

## 1. Shields button

```
variants   up (accent fill, on-accent glyph), down (muted, text-muted glyph),
           with block-count badge ( xs pill, accent-bg fill, accent text )
sizes      toolbar 32x32 icon button
states     default, hover (accent-hover), active (accent-active),
           focus-visible (2px ring), disabled (no request in flight),
           loading (badge shows a 1.5px arc, name unchanged)
tokens     bg accent, hover accent-hover, active accent-active, text on-accent,
           radius pill, icon 16
a11y       real <button type="button"> in the toolbar (XUL <toolbarbutton> with
           role preserved). aria-pressed reflects Shields up/down for the current
           tab, and the badge is part of the label: "Shields are up for
           example.com, 42 items blocked". Count changes are announced politely
           via a live region, not by moving focus.
           Down state uses aria-pressed="false"; the grey fill is decoration and
           the state is never colour-only.
used on    S06 (browser window), S07
notes      The badge is the entry point to S09; when it is 0 the button is still
           enabled (0 is information, not a disabled state).
```

## 2. Shields panel

```
variants   Simple view (read-only summary + Shields up/down), Advanced view
           (full controls; same rows as the global settings page)
sizes      popup 360px wide; full-page variant 560px for the settings page
states     open, read-only (Simple), overridden (row shows an "overridden" dot +
           text, not just colour), Shields down (grey header, copy changes)
tokens     bg surface, border, text, text-muted, accent, accent-bg, radius lg,
           shadow pop
a11y       Rendered as a dialog with <dialog>-style focus trap semantics in the
           popup context: focus moves to the panel heading on open, returns to
           the toolbar button on close. Esc closes. Every row is a labelled
           control (see #3). The domain heading is a real <h2> so it appears in
           the screen reader's heading list.
           "Overridden" is announced with an aria-label suffix
           ("Trackers and ads blocking, overridden for this site"), so the dot
           alone is never the signal.
used on    S07, S08
notes      Simple view is read-only except the Shields up/down toggle; that is a
           product rule from the recon, and the disabled rows must say why
           ("Switch to Advanced controls to change this").
```

## 3. Permission-style toggle row

```
variants   on / off; indeterminate (mixed per-site vs global) shown as a dash,
           never a half-filled pill
sizes      row height 40px, label sm/400, optional description xs/500 muted
states     default, on, off, indeterminate, hover, focus-visible, disabled,
           error (row-level message)
tokens     track on = accent, track off = border-strong, thumb = text-inverse,
           text, text-muted, radius pill
a11y       Native <input type="checkbox" role="switch"> visually styled, or a
           <button role="switch" aria-checked>. Space toggles. The label is a
           real <label for>; the description is aria-describedby.
           Indeterminate must set aria-checked="mixed".
           Off is 3:1 against the row (border-strong on surface = 3.05:1).
used on    S08, S10, S22, S23, S27 (sync categories), S03 (NTP widgets)
```

## 4. Segmented control

```
variants   2–3 options; e.g. Trackers & ads: Standard / Aggressive / Off,
           Top sites: Favorites / Frequently visited, Theme: Light / Dark
sizes      sm 28px, md 36px height; padding-x 12; radius pill
states     unselected, selected, hover, focus-visible, disabled
tokens     selected bg accent / text on-accent; unselected bg transparent /
           text text-muted; border border; radius pill
a11y       Roving tabindex with role="radiogroup" + aria-checked radio buttons,
           or a single <input type="radio"> group. Left/Right arrows move and
           select; Home/End go to the ends. Each option is a real <button>
           role="radio" so Enter does not double-activate.
           Selected is 6.05:1 (on-accent on accent).
used on    S08, S05, S32, S22 (theme)
notes      The segment labels are our own copy; the reference's wording is not reused.
```

## 5. Dropdown setting

```
variants   closed list (Cookie control 3-state, region list, open-links-where),
           with icons, with trailing hint text
sizes      md 36px height, full row width; menu max-height 264px, scrollable
states     closed, open, selected, hover, focus-visible, disabled, loading
           (list fetching), empty ("No regions cached yet")
tokens     bg bg, border border-input, text, text-muted, bg surface for the
           menu, shadow pop, radius md
a11y       Native <select> when the list is short and static (best platform
           behaviour and mobile support). A listbox pattern (button +
           role="listbox" + role="option") when we need the multi-line rows:
           Up/Down move, Home/End jump, typing a letter jumps to that option,
           Esc closes and restores focus to the trigger, focus is trapped in
           the open menu.
           The selected option carries aria-selected="true"; the button's
           accessible name is "Cookie control, Block third-party cookies".
used on    S08, S32, S42, S41 (region list)
```

## 6. Blocked-items count link

```
variants   numeric badge; zero/nonzero
sizes      inline with row label; pill md height 20, xs text
states     clickable, hover, focus-visible, disabled (0 while counting),
           loading (counting)
tokens     bg accent-bg, text accent, hover bg accent / text on-accent
a11y       Real <button>. Name: "Show the 42 items blocked on this page".
           When the count is 0 the button stays enabled and opens an empty-state
           list (S09 empty), because the reference's disabled-at-zero behaviour
           hides information from keyboard and screen-reader users.
used on    S07, S09
```

## 7. Address bar / omnibox

```
variants   idle, typing with suggestion dropdown, error (DNS/connection, red
           hairline + message), Tor-styled, private-styled
sizes      height 36px, radius md, icon 16, dropdown item 32px
states     idle, typing, dropdown open, error, Tor, private, focus-visible,
           disabled (window has no tab)
tokens     bg surface-sunken, focus bg bg + border focus, text, text-muted,
           radius md, shadow pop for the dropdown
a11y       combobox pattern: <input role="combobox" aria-expanded
           aria-controls aria-activedescendant>, listbox of suggestions.
           Down/Up move the active option, Esc closes the list without losing
           the typed text, Enter accepts. Page-info state (S16) is a separate
           focusable button inside the bar with its own label
           ("Connection is secure for example.com").
used on    S06
notes      The Tor/private styling is a *badge* plus an accessible name suffix,
           never only a colour change.
```

## 8. Permission bubble

```
variants   camera, mic, location, notifications, clipboard; multi-request
           (several origins stacked, each independently actionable)
sizes      320px wide; two buttons sm/md; optional "Always allow" checkbox row
states     requesting, granted (transient success line), denied (transient),
           dismissed, remembered ("Always allow" chosen)
tokens     bg surface, border, shadow pop, text, text-muted, accent,
           radius lg
a11y       role="alertdialog" with aria-modal="false" (it is non-blocking) and
           focus moved to the first action button; Esc dismisses (a dismissal
           is a "not now", and the label says so). Each choice is a real
           <button>. The origin is in the accessible name.
           The high-accuracy note for geolocation is part of the description,
           not a tooltip.
used on    S15
```

## 9. URL bar page-info popup

```
variants   secure, insecure, certificate error
sizes      360px; rows 32px
states     expanded, collapsed, cert error (danger text + "View certificate"
           button), loading (fetching cert details)
tokens     text, text-muted, success/danger for state, bg surface, border
a11y       Disclosure button in the address bar, aria-expanded; the popup is a
           labelled group (role="group" aria-label="Site information for …").
           Certificate error is announced with role="alert" when it appears
           because it is a security state, not decoration.
used on    S16
```

## 10. New Tab Page widget

```
variants   background, search, top sites, news, clock, cards, stats
sizes      search 48px pill; tiles 96px; stats row 3 columns
states     visible, hidden (toggle off in S03), empty (its own empty copy),
           loading (news refreshing), error (feed unreachable)
tokens     bg bg (over the background image), frost fill for stats/news,
           text/text-inverse on photo, accent, radius lg/pill
a11y       NTP is `chrome_url_overrides.newtab`; landmarks for each widget
           role="region" aria-label. The clock updates politely (aria-live off
           for a ticking clock — instead publish the time in a
           role="status" only when the user asks). Background images carry the
           photo credit as visible text (reference did this) *and* an
           aria-label, and the credit is never decorative.
used on    S02, S03, S51
```

## 11. Top-site tile

```
variants   favicon + label; edit affordance; remove; drag handle; paged
sizes      96x96 tile (radius md), label 2 lines max xs
states     default, hover (menu), edit dialog open, drag (opacity .5),
           paged (carousel dots), empty ("Add the sites you use most")
tokens     frost bg, border, text, text-muted, accent, radius md
a11y       Tile is a <button> that navigates; the ⋮ menu is a second <button>
           with aria-haspopup="menu" and aria-label "Options for <site>".
           Keyboard reorder: with the tile focused, Ctrl+Arrow moves it and the
           move is announced (drag-and-drop alone is not accessible).
used on    S05
```

## 12. Tile grid

```
variants   compact 6 per page, expanded 12x2 paginated
sizes      gap 16; breakpoints sm/md/lg from tokens
states     one page, multiple pages (pager with dots + prev/next buttons)
tokens     space scale only; no colour of its own
a11y       If it scrolls/pagins, it is a labelled region with a pager that has
           real buttons ("Previous page", "Next page") and a live-region
           announcement of page 2 of 2.
used on    S05
```

## 13. Add/Edit site dialog

```
variants   add, edit (prefilled)
sizes      420px wide; inputs sm
states     open, invalid (URL field error + message), saving, saved
tokens     bg surface, border, text, text-muted, danger, radius lg, shadow pop
a11y       <dialog> with showModal() (native focus trap + Esc). Focus starts in
           the name field; errors are tied with aria-describedby and
           aria-invalid="true"; the submit button is a real <button> and the
           form submits on Enter.
used on    S05
```

## 14. Sidebar rail

```
variants   Talk, Bookmarks, custom sites, add button
sizes      width 48px (rail) / 340px (panel); buttons 32px
states     expanded, collapsed, mouseover-only (a mode from the recon), active
           panel, drag-reorder
tokens     bg bg, border, active fill accent + on-accent glyph, hover
           surface-sunken, radius md
a11y       Rail is role="tablist" (vertical), buttons role="tab" with
           aria-selected and aria-controls pointing at the panel; Up/Down move
           between tabs, Enter/Space open. The add button is a separate
           <button> at the end of the list with an accessible name, not a bare "+".
           The panels are `sidebar_action` pages; each panel gets its own
           landmark label ("Talk", "Bookmarks").
used on    S06, S39
notes      Gecko has no sidebar setBadgeText, so panel counts (unread items,
           active call) live in the panel DOM with a live region.
```

## 15. Sidebar panel

```
variants   Talk tree, Bookmarks tree
sizes      width 340px; header 48px; footer composer 56px
states     empty (its own first-run copy), filled, loading (skeleton rows),
           error (retry button)
tokens     bg surface, border, text, text-muted, accent, accent-bg
a11y       Panel is role="region" with a heading; scrolling region is
           aria-labelled and focusable with the keyboard
           (for the panel feed use role="region" + polite status).
           Empty states contain a real action, not just text.
used on    S06, S39
```

## 16. Sync code display

```
variants   24-word code, QR code, "add another device"
sizes      word grid 3 columns; QR 160px; mono xs
states     fresh, copied (toast + name change "Copied"), used, expired
tokens     bg surface-sunken for the code plate, text, mono font, radius md
a11y       The code is selectable text, not an image. The copy button announces
           success via role="status". The QR has a text alternative: the same
           24 words plus the rotating 25th word, with an explanation of why the
           extra word exists.
used on    S27
```

## 17. Sync category toggle

```
variants   bookmarks, passwords, autofill, history, open tabs, extensions,
           themes, apps
sizes      row 40px, switch 32x20
states     on, off, disabled (category not supported on this device), syncing
tokens     accent / border-strong / text / text-muted
a11y       Same switch pattern as #3; the per-category enforcement is
           server-side per the architecture, and the UI says so in the row
           description.
used on    S27
```

## 18. Confirm / destructive dialog

```
variants   leave chain, delete account, reset settings, clear browsing data
sizes      480px wide; danger button sm/md; cancel always present
states     open, confirming (async work), error (confirm failed)
tokens     danger / on-danger for the destructive action, bg surface, border,
           shadow pop, radius lg
a11y       <dialog> showModal(); initial focus on Cancel (never on the
           destructive action); Esc cancels; the destructive button's name
           states the consequence ("Leave the sync chain"), not "OK".
           Irreversible actions require typing the confirmation word when the
           recon marks them irreversible (delete account): the confirm button
           stays disabled until it matches.
used on    S27, S48
```

## 19. Talk control bar

```
variants   mute, camera, screen share, chat, raise hand, participants, tiles
sizes      bar 48px, buttons 36px
states     active, muted (state in the name), camera off, sharing (accent),
           reconnecting, disconnected
tokens     bg surface, border, on/off fill, accent when active, radius pill
a11y       Every button is aria-pressed and its label includes the state
           ("Microphone, muted"). The participant count is a live region.
           During a call the panel keeps a single tab stop per button.
used on    S39
```

## 20. Talk advanced-actions menu

```
variants   participant options, owner-only options
sizes      menu 260px
states     open, owner-only (locked items with a reason), closed
tokens     bg surface, border, shadow pop, text, text-muted
a11y       role="menu" with aria-orientation vertical, roving tabindex,
           type-ahead. Owner-only items are aria-disabled and explain
           ("Only the meeting owner can lock the room").
used on    S39
```

## 21. Recovery-phrase grid

```
variants   12 / 24 words
sizes      3 columns; cell 36px; mono sm
states     displayed, hidden (blur until revealed), revealed, copied, confirmed
tokens     surface-sunken plate, text, mono font, accent, radius md
a11y       Reveal is an explicit toggle (never auto-reveal); the toggle is a
           labelled button. The grid is text, selectable and copyable; the
           confirm step requires re-entering the words in order, with per-word
           error messages. No analytics, no clipboard auto-write.
used on    S37
```

## 22. Find bar

```
variants   match count, prev/next, case toggle, highlight-all
sizes      height 40px; inputs sm
states     open, 0 matches ("No matches on this page"), wrapped (a one-line
           message), closed
tokens     bg surface, border, text, text-muted, accent, radius md
a11y       The match count is role="status" so it announces on change without
           stealing focus; Up/Down and Enter cycle; Esc closes and returns
           focus to the page. 0 matches is conveyed by text, not only colour.
used on    S14
```

## 23. Downloads row

```
variants   file row, progress, pause/resume, open folder, malware warning
sizes      row 56px; progress 4px
states     queued, downloading, paused, done, failed, blocked (malware)
tokens     text, text-muted, accent for progress, danger for failed/blocked,
           border, radius md
a11y       Progress is a real <progress> element with a text alternative;
           pause/resume is one toggle button whose label flips; "blocked" rows
           state the reason ("Blocked: flagged as unsafe") and never just turn
           the row red. Completed rows announce via role="status".
used on    S17
```

## 24. Toast / notification

```
variants   download done, Talk invite, sync connected
sizes      width 360px, bottom-right, radius md
states     shown, dismissed, expired
tokens     bg surface, border, shadow pop, text, text-muted, action text accent
a11y       role="status" for non-urgent, role="alert" for failures; toasts are
           focusable and dismissible with Esc; they never appear over the
           focused element without a way to move away. Auto-dismiss only after
           a generous timer and never for anything with an action that matters.
used on    S17, S27
```

## 25. Settings section nav

```
variants   collapsible groups, search-filtered
sizes      width 240px; item 32px; group header xs uppercase
states     current, other, search-filtered (empty result state with copy),
           loading
tokens     bg bg, text, text-muted, accent for current, accent-bg for the
           current row's fill, border
a11y       <nav aria-label="Settings sections"> with an aria-current="page" on
           the active link; groups use <button aria-expanded>; the search box
           filters with a live-region count of results.
used on    S21, S10, S22, S23, S24
```

## 26. Tab strip

```
variants   horizontal, vertical tab mode, tab groups, pinned tabs
sizes      height 40px; tab 64–240px wide; radius 8
states     normal, loading (accent 3px underline + spinner glyph),
           crashed ("Reload this tab" state on the tab), group-collapsed,
           private (own palette), Tor (own palette), audio-playing,
           selected, hover, focus-visible
tokens     bg surface, active tab bg bg, text, text-muted, accent underline,
           border, radius 8
a11y       role="tablist" with role="tab"; each tab is selectable with
           Left/Right (Home/End move to the ends, Ctrl+PageUp/Down as an
           alternative the shortcut table can use). Pinned tabs get a
           "Unpin" action in their context menu. Loading and crashed are in
           the accessible name, not only visual.
used on    S06, S44, S45
notes      This is userChrome.css-owned chrome; the strip gets the 2px accent
           bar ( --chrome-accent-bar ) as Ziy's signature chrome element.
```

## 27. Toolbar + address bar

```
variants   default, customised (overflow chevron), private window, Tor window
sizes      height 48px; buttons 32px; URL bar 36px
states     normal, URL bar focused (2px accent ring), overflow menu open,
           window without tabs
tokens     bg bg, border, focus/accent, text, text-muted, radius md
a11y       Real toolbar buttons with labels (icon-only buttons keep
           aria-label). The overflow chevron opens a menu that is reachable
           with the keyboard and closes with Esc. Focus is visible on every
           button, including in the dark theme (focus #2dd4bf on #17181a = 9.5:1).
used on    S06, S13
```

## 28. Find bar (chrome-level, owned via userChrome.css)

```
variants   standard; "highlight all" toggle
sizes      height 40px; sits at the top-right of the content area
states     open, 0 matches, wrapped, closed
tokens     surface bg, border, accent for the toggle, text
a11y      Same contract as component #23; the find input is focused on open and
           Esc returns focus to the page.
used on    S14
```

## 29. NTP (chrome-level)

```
variants   full dashboard, minimal (widgets off), background image / solid /
           gradient
sizes      search 48px pill; widget radius lg; max content width 1128px
states     empty (all widgets off), filled, background opted out
tokens     bg, frost, text/text-inverse, accent, radius lg/pill
a11y       Landmarks per widget; the search field is labelled ("Search or type
           a web address"); the stats widget is a real <dl>; the clock has a
           text alternative that is not a ticking live region.
used on    S02, S03, S04, S51
```

---

## Shared state recipes (apply to all of the above)

```
focus-visible   outline: 2px solid var(--focus); outline-offset: 2px; radius sm.
                Verified 6.05:1 (light) and 9.54:1 (dark) on every surface.
disabled        opacity .6; cursor: not-allowed; aria-disabled="true"; never
                removes an informative control from the tab order.
loading         spinner 16px aria-hidden; label unchanged; container
                aria-busy="true"; focus does not move.
error           danger text on danger-bg (5.72:1) + icon + role="alert" +
                aria-invalid on the field. Never colour alone.
empty           own Ziy voice, one real action, no "Nothing here".
motion          fast 120ms, base 200ms, ease cubic-bezier(.2,.8,.2,1);
                all of it collapses under prefers-reduced-motion.
forced-colors   tokens.css bumps borders; components must not set their own
                background/border colours in forced-colors mode.
```

## Icon set

Lucide (MIT) for every UI glyph. Brand marks live in `replica/design/brand/`.
No icon from the reference product is copied, redrawn or recoloured.

## Copy rule (applies to every string in every block)

Labels, empty states and status messages are written fresh for Ziy. The
reference's phrasing — including its blocker-count sentence and its brand name
— never appears. Where a component needs a number-heavy status line, Ziy voices
it in its own words (e.g. "Blocking is on for this site. 42 requests stopped
this visit.") and that wording lives in the component spec above, not in a
generic i18n fallback.
