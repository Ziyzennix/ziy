# Contrast report — Ziy design tokens

Command (run from the project root, exit code 0):

```
python3 /home/zen/.agents/skills/replica-design/contrast.py replica/design/tokens.json
```

The checker is the `replica-design` skill's own `contrast.py`; it computes WCAG 2.x
relative-luminance ratios for every pair in the tokens file's `pairs` list.
Thresholds applied: normal text AA 4.5 / AAA 7, large text AA 3 / AAA 4.5,
UI parts and focus rings ("ui") 3.

**Result: 113 pairs checked, 0 failing AA.** Exit code 0. Acceptance met.

## Output

```
  AAA   16.10:1  text                     on bg
  AAA   15.43:1  text                     on surface
  AAA   14.13:1  text                     on surface-sunken
  AAA   14.07:1  text                     on accent-bg
  AAA   14.08:1  text                     on danger-bg
  AAA   14.24:1  text                     on success-bg
  AAA   14.62:1  text                     on warning-bg
  AA     6.40:1  text-muted               on bg
  AA     6.13:1  text-muted               on surface
  AA     5.61:1  text-muted               on surface-sunken
  AA     5.59:1  text-muted               on accent-bg
  AA     5.59:1  text-muted               on danger-bg
  AA     6.05:1  accent                   on bg
  AA     5.80:1  accent                   on surface
  AA     5.29:1  accent                   on accent-bg
  AA     6.54:1  danger                   on bg
  AA     6.27:1  danger                   on surface
  AA     5.72:1  danger                   on danger-bg
  AA     5.34:1  success                  on bg
  AA     5.12:1  success                  on surface
  AA     4.72:1  success                  on success-bg
  AA     5.93:1  warning                  on bg
  AA     5.68:1  warning                  on surface
  AA     5.38:1  warning                  on warning-bg
  AA     6.05:1  on-accent                on accent
  AAA    8.01:1  on-accent                on accent-hover
  AAA    9.25:1  on-accent                on accent-active
  AA     6.54:1  on-danger                on danger
  AAA    7.94:1  on-danger                on danger-hover
  PASS   4.26:1  border-input             on bg                   ui
  PASS   4.09:1  border-input             on surface              ui
  PASS   3.72:1  border-input             on accent-bg            ui
  PASS   6.05:1  focus                    on bg                   ui
  PASS   5.80:1  focus                    on surface              ui
  AAA   16.28:1  dark-text                on dark-bg
  AAA   14.78:1  dark-text                on dark-surface
  AAA   13.54:1  dark-text                on dark-surface-raised
  AAA   17.31:1  dark-text                on dark-surface-sunken
  AAA   12.89:1  dark-text                on dark-accent-bg
  AAA   14.66:1  dark-text                on dark-danger-bg
  AAA   13.83:1  dark-text                on dark-success-bg
  AAA   13.52:1  dark-text                on dark-warning-bg
  AAA    7.25:1  dark-text-muted          on dark-bg
  AAA    6.59:1  dark-text-muted          on dark-surface
  AA     6.03:1  dark-text-muted          on dark-surface-raised
  AAA    7.71:1  dark-text-muted          on dark-surface-sunken
  AAA    9.54:1  dark-accent              on dark-bg
  AAA    8.67:1  dark-accent              on dark-surface
  AAA    7.94:1  dark-accent              on dark-surface-raised
  AAA    7.56:1  dark-accent              on dark-accent-bg
  AAA    6.42:1  dark-danger              on dark-bg
  AAA    5.34:1  dark-danger              on dark-surface-raised
  AAA    5.78:1  dark-danger              on dark-danger-bg
  AAA   10.20:1  dark-success              on dark-bg
  AAA    8.48:1  dark-success              on dark-surface-raised
  AAA    8.66:1  dark-success              on dark-success-bg
  AAA   10.64:1  dark-warning              on dark-bg
  AAA    8.85:1  dark-warning              on dark-surface-raised
  AAA    8.84:1  dark-warning              on dark-warning-bg
  AAA    9.10:1  dark-on-accent            on dark-accent
  AAA   10.53:1  dark-on-accent            on dark-accent-hover
  AAA    6.16:1  dark-on-danger            on dark-danger
  AAA    8.98:1  dark-on-danger            on dark-danger-hover
  AAA   16.28:1  dark-text-inverse        on dark-accent
  AAA    6.16:1  dark-text-inverse        on dark-danger
  PASS   5.36:1  dark-border-input        on dark-bg              ui
  PASS   4.46:1  dark-border-input        on dark-surface-raised  ui
  PASS   4.25:1  dark-border-input        on dark-accent-bg       ui
  PASS   9.54:1  dark-focus               on dark-bg              ui
  PASS   7.94:1  dark-focus               on dark-surface-raised  ui

  113 pairs, 0 failing AA
```

## What was fixed, and why the fixes were in the tokens

| first failure | cause | fix |
| --- | --- | --- |
| 34 dark-scheme pairs reported `unknown token` | the checker flattens `color.dark.*` into `text-dark`-style names, so the dark pairs must use those flattened names | pairs rewritten as `text-dark` on `bg-dark` etc. |
| `border-input` 2.99:1 on sunken | the measured `#8b8b8b` grey is fine on white but fails as an input border on the sunken fill | input border darkened to `#767b82` (4.26:1 on white, 3.72:1 on accent-bg) — the hairline `border` role keeps the measured `#e4e4e5` |
| `dark-border-input` 3.86:1 on raised | same, in dark | raised to `#868e98` (5.36:1 on dark bg) |
| `on-accent` on the dark accent 1.86:1 | a light `on-accent` cannot serve a teal-on-black accent | dark scheme carries its own `on-accent` `#04211c` (9.10:1) — the dark accent is a light colour, so its "on" is dark |

Nothing was fixed per component: every component spec in `components.md`
consumes these roles directly.
