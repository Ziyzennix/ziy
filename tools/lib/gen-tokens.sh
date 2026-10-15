#!/usr/bin/env bash
# tools/lib/gen-tokens.sh — regenerate extensions/ziy-shell/ui/tokens.css from
# the design tokens (replica/design/tokens.json).
#
# The extension UI must never hard-code a hex, and the design system's single
# source of truth is tokens.json. This script is the mechanical bridge: it
# emits exactly the CSS custom properties replica/design/tokens.css documents
# (same role names, same values, same [data-theme="dark"] selector) as a
# SELF-CONTAINED file, so an extension page can use them without importing
# anything outside the extension package.
#
# Mapping rules (from replica/design/tokens.css, not invented here):
#   color.<role>            -> --<role>                       (light)
#   color.dark.<role>       -> --<role> inside [data-theme="dark"]
#   font.sans / font.mono   -> --font-sans / --font-mono
#   type.<size>.{size,line,weight} -> --text-<size>, --leading-<size>, --weight-<size>
#   space[n]                -> --space-<n>                    (px)
#   radius.<name>           -> --radius-<name>                (px)
#   shadow.<name>           -> --shadow-<name>
#   motion.<name>           -> --motion-<name>
#   layout / browser-chrome scalar values -> --<role>          (px)
#
#    tools/lib/gen-tokens.sh [tokens.json] [out.css]
#
# The output is committed. After a tokens.json change, re-run this script;
# never hand-edit the output.
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IN="${1:-$HERE/../../replica/design/tokens.json}"
OUT="${2:-$HERE/../../extensions/ziy-shell/ui/tokens.css}"

mkdir -p "$(dirname "$OUT")"

IN="$IN" OUT="$OUT" python3 <<'PY'
import json, os, re

src = os.environ["IN"]
dst = os.environ["OUT"]
doc = json.load(open(src, encoding="utf-8"))

PX_KEYS = re.compile(r".*-(height|width|max|min|bar)$|^(toolbar-height|nav-width"
                     r"|side-rail-width|side-panel-width|content-max|find-bar-height"
                     r"|chrome-accent-bar)$")

def kebab(s):
    return re.sub(r"(?<!^)(?=[A-Z])", "-", s).lower()

def px(value):
    """Tokens carry bare numbers for length roles; CSS wants units."""
    return f"{value}px"

color = doc["color"]
dark = color.pop("dark", {})
shadow = doc["shadow"]
layout = doc["layout"]
browser_chrome = {k: v for k, v in doc["browser-chrome"].items() if not k.startswith("_")}

def color_block(tokens):
    lines = []
    for key in sorted(tokens):
        lines.append(f"  --{kebab(key)}: {tokens[key]};")
    return lines

def scale_block():
    lines = []
    for name, spec in sorted(doc["type"].items()):
        lines.append(f"  --text-{name}: {spec['size']}px;  --leading-{name}: {spec['line']}px;  --weight-{name}: {spec['weight']};")
    for i, value in enumerate(doc.get("space", [])):
        lines.append(f"  --space-{i}: {value}px;")
    for name, value in sorted(doc["radius"].items()):
        lines.append(f"  --radius-{name}: {value}px;")
    for name, value in sorted(shadow.items()):
        lines.append(f"  --shadow-{name}: {value};")
    for name, value in sorted(doc["motion"].items()):
        v = value if not isinstance(value, (int, float)) else f"{value}ms"
        lines.append(f"  --motion-{name}: {v};")
    for name, family in sorted(doc["font"].items()):
        lines.append(f"  --font-{name}: {family};")
    return lines

def chrome_block():
    lines = []
    for group, spec in sorted(browser_chrome.items()):
        for key, value in sorted(spec.items()):
            if key.startswith("_"):
                continue
            name = f"--{kebab(group)}-{kebab(key)}"
            if isinstance(value, bool):
                lines.append(f"  {name}: {'true' if value else 'false'};")
            elif isinstance(value, (int, float)):
                lines.append(f"  {name}: {px(value)};")
            else:
                lines.append(f"  {name}: {value};")
    return lines

def layout_block():
    lines = []
    for key, value in sorted(layout.items()):
        if key == "breakpoints":
            for bp, v in sorted(value.items()):
                lines.append(f"  --breakpoint-{bp}: {px(v)};")
            continue
        lines.append(f"  --{kebab(key)}: {px(value)};")
    return lines

out = []
out.append("/* Ziy extension design tokens.")
out.append("   GENERATED from replica/design/tokens.json by tools/lib/gen-tokens.sh.")
out.append("   Do not edit by hand; re-run the script instead.")
out.append("")
out.append("   The design system's single source of truth is tokens.json, and")
out.append("   replica/design/tokens.css is its CSS mirror for the shell. This file is the")
out.append("   same mirror, inlined so the extension package stays self-contained. Dark")
out.append("   values apply on [data-theme=\"dark\"]. Never hard-code a hex in a component.")
out.append("   */")
out.append("")
out.append(":root {")
out.append("  color-scheme: light;")
out.append("")
out += color_block(color)
out.append("")
out += scale_block()
out.append("")
out += layout_block()
out.append("")
out += chrome_block()
out.append("}")
out.append("")
out.append('[data-theme="dark"] {')
out.append("  color-scheme: dark;")
out.append("")
out += color_block(dark)
out.append("}")
out.append("")
out.append("/* Focus ring, one definition, used by every interactive surface.")
out.append("   WCAG 2.2: 2px ring + 2px offset, never suppressed. */")
out.append(':where(button, a, input, select, textarea, [tabindex], summary, [role="button"], [role="tab"], [role="option"]):focus-visible {')
out.append("  outline: 2px solid var(--focus);")
out.append("  outline-offset: 2px;")
out.append("  border-radius: var(--radius-sm);")
out.append("}")
out.append("")
out.append("@media (prefers-reduced-motion: reduce) {")
out.append("  *, *::before, *::after {")
out.append("    animation-duration: .01ms !important;")
out.append("    transition-duration: .01ms !important;")
out.append("  }")
out.append("}")
out.append("")
out.append("@media (prefers-contrast: more) {")
out.append("  :root { --border: #c9c9ca; --border-strong: #8b8b8b; --border-input: #5c5f66; }")
out.append('  [data-theme="dark"] { --border: #6b6f76; --border-strong: #868e98; --border-input: #a1a6ad; }')
out.append("}")
out.append("")
out.append("@media (forced-colors: active) {")
out.append('  :where(button, input, select, textarea, [role="button"]):focus-visible { outline-color: Highlight; }')
out.append("}")
out.append("")

with open(dst, "w", encoding="utf-8") as fh:
    fh.write("\n".join(out))
print(f"wrote {dst} ({len(out)} lines)")
PY
