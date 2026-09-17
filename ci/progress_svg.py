#!/usr/bin/env python3
# Deterministic SWIR Progress SVG generator/checker for xADKiller development tracks.

from __future__ import annotations

import argparse
import html
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CONFIG = {
    "android": {
        "project": "xADKiller Android",
        "scope": "v1.6.0 development roadmap",
        "source": "ANDROID_V160_ROADMAP.md",
        "status": "HARDENING",
        "output": "assets/readme/android",
        "start": None,
        "end": None,
    },
    "chrome": {
        "project": "xADKiller Chrome",
        "scope": "v1.5.0 Adaptive Memory & Stability roadmap",
        "source": "browser-extension/ROADMAP_CHROME.md",
        "status": "HARDENING",
        "output": "assets/readme/chrome",
        "start": "## v1.5.0",
        "end": "## Later",
    },
}

CHECKBOX_RE = re.compile(r"^\s*-\s+\[([ xX])\]\s+", re.MULTILINE)
FORBIDDEN = ("<script", "foreignObject", "@font-face", "<image", "xlink:href", " href=")


def scoped_text(text: str, start: str | None, end: str | None) -> str:
    if start:
        pos = text.find(start)
        if pos < 0:
            raise ValueError(f"scope start not found: {start}")
        text = text[pos:]
    if end:
        pos = text.find(end)
        if pos >= 0:
            text = text[:pos]
    return text


def measure(cfg: dict[str, str | None]) -> dict[str, object]:
    source_path = ROOT / str(cfg["source"])
    text = source_path.read_text(encoding="utf-8")
    scoped = scoped_text(text, cfg["start"], cfg["end"])
    states = CHECKBOX_RE.findall(scoped)
    total = len(states)
    completed = sum(1 for state in states if state.lower() == "x")
    if total == 0:
        return {
            "completed": None,
            "total": None,
            "fraction": None,
            "display": "N/A",
            "counter": "Roadmap items: N/A (scope is not enumerated)",
        }
    fraction = completed / total
    percentage = fraction * 100.0
    if fraction < 1.0 and round(percentage, 1) >= 100.0:
        display = "<100%"
    else:
        display = f"{percentage:.1f}%"
    return {
        "completed": completed,
        "total": total,
        "fraction": fraction,
        "display": display,
        "counter": f"Roadmap items: {completed}/{total} verified",
    }


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def fill_width(track_width: float, fraction: float | None) -> float | None:
    if fraction is None:
        return None
    if not math.isfinite(fraction) or fraction < 0.0 or fraction > 1.0:
        raise ValueError(f"invalid progress fraction: {fraction}")
    return track_width * fraction


def fmt(value: float) -> str:
    text = f"{value:.6f}".rstrip("0").rstrip(".")
    return text or "0"


def card_svg(cfg: dict[str, str | None], data: dict[str, object]) -> str:
    fraction = data["fraction"]
    width = fill_width(1100.0, fraction if isinstance(fraction, float) else None)
    fill = ""
    if width is not None and width > 0:
        fill = (
            f'  <rect id="progress-fill" x="50" y="138" width="{fmt(width)}" height="18" '
            'rx="9" fill="url(#progressGradient)" filter="url(#softGlow)" clip-path="url(#trackClip)"/>\n'
        )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="180" viewBox="0 0 1200 180" role="img" aria-labelledby="title desc">
  <title id="title">{esc(cfg["project"])} progress — {esc(data["display"])}</title>
  <desc id="desc">{esc(cfg["scope"])}. Status {esc(cfg["status"])}. {esc(data["counter"])}. Development progress and release readiness are separate gates.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#02050A"/>
      <stop offset="1" stop-color="#07111C"/>
    </linearGradient>
    <linearGradient id="progressGradient" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0088FF"/>
      <stop offset="1" stop-color="#62E5FF"/>
    </linearGradient>
    <filter id="softGlow" x="-10%" y="-80%" width="120%" height="260%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M36 0H0V36" fill="none" stroke="#62E5FF" stroke-opacity=".035" stroke-width="1"/>
    </pattern>
    <clipPath id="trackClip"><rect x="50" y="138" width="1100" height="18" rx="9"/></clipPath>
  </defs>
  <rect x="1" y="1" width="1198" height="178" rx="22" fill="url(#bg)" stroke="#62E5FF" stroke-opacity=".28" stroke-width="2"/>
  <rect x="2" y="2" width="1196" height="176" rx="21" fill="url(#grid)"/>
  <text x="50" y="31" fill="#62E5FF" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="2">SWIR PROGRESS</text>
  <text x="50" y="68" fill="#F4FAFF" font-family="Segoe UI,Arial,sans-serif" font-size="28" font-weight="700">{esc(cfg["project"])}</text>
  <text x="50" y="96" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="15">{esc(cfg["scope"])}</text>
  <rect x="935" y="25" width="215" height="34" rx="17" fill="#07111C" stroke="#0088FF" stroke-opacity=".75"/>
  <text x="1042.5" y="47" text-anchor="middle" fill="#62E5FF" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700">{esc(cfg["status"])}</text>
  <text x="50" y="122" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="13">{esc(data["counter"])}</text>
  <text x="1150" y="122" text-anchor="end" fill="#F4FAFF" font-family="Segoe UI,Arial,sans-serif" font-size="24" font-weight="700">{esc(data["display"])}</text>
  <rect id="progress-track" x="50" y="138" width="1100" height="18" rx="9" fill="#0A1A28" stroke="#8DA8B8" stroke-opacity=".22"/>
{fill}  <text x="1150" y="171" text-anchor="end" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="10">Release readiness is tracked separately.</text>
</svg>
'''


def mini_svg(cfg: dict[str, str | None], data: dict[str, object]) -> str:
    fraction = data["fraction"]
    width = fill_width(700.0, fraction if isinstance(fraction, float) else None)
    fill = ""
    if width is not None and width > 0:
        fill = (
            f'  <rect id="progress-fill" x="170" y="45" width="{fmt(width)}" height="12" '
            'rx="6" fill="url(#progressGradient)" clip-path="url(#trackClip)"/>\n'
        )
    counter = "items N/A" if data["total"] is None else f'{data["completed"]}/{data["total"]} items'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="72" viewBox="0 0 900 72" role="img" aria-labelledby="title desc">
  <title id="title">{esc(cfg["project"])} roadmap progress — {esc(data["display"])}</title>
  <desc id="desc">{esc(cfg["scope"])}. {esc(cfg["status"])}. {esc(data["counter"])}.</desc>
  <defs>
    <linearGradient id="progressGradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0088FF"/><stop offset="1" stop-color="#62E5FF"/></linearGradient>
    <clipPath id="trackClip"><rect x="170" y="45" width="700" height="12" rx="6"/></clipPath>
  </defs>
  <rect x="1" y="1" width="898" height="70" rx="16" fill="#02050A" stroke="#62E5FF" stroke-opacity=".25" stroke-width="2"/>
  <text x="18" y="27" fill="#F4FAFF" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="700">{esc(cfg["project"])}</text>
  <text x="190" y="27" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="12">{esc(cfg["scope"])}</text>
  <text x="565" y="27" fill="#62E5FF" font-family="Segoe UI,Arial,sans-serif" font-size="11" font-weight="700">{esc(cfg["status"])}</text>
  <text x="675" y="27" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="11">{esc(counter)}</text>
  <text x="870" y="27" text-anchor="end" fill="#F4FAFF" font-family="Segoe UI,Arial,sans-serif" font-size="15" font-weight="700">{esc(data["display"])}</text>
  <text x="18" y="56" fill="#62E5FF" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="700">SWIR</text>
  <rect id="progress-track" x="170" y="45" width="700" height="12" rx="6" fill="#07111C" stroke="#8DA8B8" stroke-opacity=".22"/>
{fill}</svg>
'''


def template_svg() -> str:
    return '''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="180" viewBox="0 0 1200 180" role="img" aria-labelledby="title desc">
  <title id="title">SWIR Progress SVG template — not project data</title>
  <desc id="desc">Reusable visual template only. TEMPLATE / NOT PROJECT DATA. Do not embed this file as live project progress.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#02050A"/><stop offset="1" stop-color="#07111C"/></linearGradient>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#62E5FF" stroke-opacity=".035" stroke-width="1"/></pattern>
  </defs>
  <rect x="1" y="1" width="1198" height="178" rx="22" fill="url(#bg)" stroke="#62E5FF" stroke-opacity=".28" stroke-width="2"/>
  <rect x="2" y="2" width="1196" height="176" rx="21" fill="url(#grid)"/>
  <text x="50" y="31" fill="#62E5FF" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="2">SWIR PROGRESS</text>
  <text x="50" y="68" fill="#F4FAFF" font-family="Segoe UI,Arial,sans-serif" font-size="28" font-weight="700">TEMPLATE / NOT PROJECT DATA</text>
  <text x="50" y="96" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="15">Replace through the deterministic generator; never hand-edit live values.</text>
  <rect x="935" y="25" width="215" height="34" rx="17" fill="#07111C" stroke="#0088FF" stroke-opacity=".75"/>
  <text x="1042.5" y="47" text-anchor="middle" fill="#62E5FF" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700">TEMPLATE</text>
  <text x="50" y="122" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="13">Counter: N/A</text>
  <text x="1150" y="122" text-anchor="end" fill="#F4FAFF" font-family="Segoe UI,Arial,sans-serif" font-size="24" font-weight="700">N/A</text>
  <rect x="50" y="138" width="1100" height="18" rx="9" fill="#0A1A28" stroke="#8DA8B8" stroke-opacity=".22"/>
</svg>
'''


def validate_svg(text: str, expected_fraction: float | None, *, track_width: float) -> None:
    for forbidden in FORBIDDEN:
        if forbidden in text:
            raise ValueError(f"forbidden SVG content: {forbidden}")
    root = ET.fromstring(text)
    if root.tag.split("}")[-1] != "svg":
        raise ValueError("root element is not svg")
    view_box = root.attrib.get("viewBox", "").split()
    if len(view_box) != 4 or any(not math.isfinite(float(part)) for part in view_box):
        raise ValueError("invalid viewBox")
    fill = None
    for element in root.iter():
        if element.attrib.get("id") == "progress-fill":
            fill = element
        for key in ("x", "y", "width", "height", "rx"):
            value = element.attrib.get(key)
            if value is None:
                continue
            try:
                number = float(value)
            except ValueError:
                continue
            if not math.isfinite(number) or number < 0:
                raise ValueError(f"invalid numeric attribute {key}={value}")
    if expected_fraction is None or expected_fraction == 0:
        if fill is not None:
            raise ValueError("N/A/zero progress must not render a progress fill")
    else:
        if fill is None:
            raise ValueError("progress fill missing")
        actual = float(fill.attrib["width"])
        expected = track_width * expected_fraction
        if abs(actual - expected) > 0.001 or actual > track_width + 0.001:
            raise ValueError(f"progress fill mismatch: {actual} != {expected}")


def generated_files(track: str) -> tuple[dict[Path, str], dict[str, object]]:
    cfg = CONFIG[track]
    data = measure(cfg)
    output = ROOT / str(cfg["output"])
    files = {
        output / "progress-card.svg": card_svg(cfg, data),
        output / "progress-mini.svg": mini_svg(cfg, data),
        output / "progress-template.svg": template_svg(),
    }
    validate_svg(files[output / "progress-card.svg"], data["fraction"], track_width=1100.0)
    validate_svg(files[output / "progress-mini.svg"], data["fraction"], track_width=700.0)
    validate_svg(files[output / "progress-template.svg"], None, track_width=1100.0)
    return files, data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("track", choices=sorted(CONFIG))
    parser.add_argument("--check", action="store_true", help="fail when committed SVG output is stale")
    args = parser.parse_args()

    files, data = generated_files(args.track)
    stale: list[str] = []
    for path, expected in files.items():
        if args.check:
            if not path.is_file() or path.read_text(encoding="utf-8") != expected:
                stale.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8", newline="\n")

    if stale:
        print("SWIR progress SVG check failed; regenerate: " + ", ".join(stale), file=sys.stderr)
        return 1

    cfg = CONFIG[args.track]
    print(
        f"SWIR progress SVG {args.track}: {data['display']} • {data['counter']} "
        f"• source={cfg['source']} • status={cfg['status']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
