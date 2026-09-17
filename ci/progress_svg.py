#!/usr/bin/env python3
"""Deterministic SWIR Progress SVG generator/checker for xADKiller tracks."""

from __future__ import annotations

import argparse
import html
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKBOX_RE = re.compile(r"^\s*-\s+\[([ xX])\]\s+", re.MULTILINE)
FORBIDDEN = ("<script", "foreignObject", "@font-face", "<image", "xlink:href", " href=")

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


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def scoped(text: str, start: str | None, end: str | None) -> str:
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


def measure(cfg: dict[str, object]) -> dict[str, object]:
    raw = (ROOT / str(cfg["source"])).read_text(encoding="utf-8")
    states = CHECKBOX_RE.findall(scoped(raw, cfg["start"], cfg["end"]))
    total = len(states)
    done = sum(1 for state in states if state.lower() == "x")
    if total == 0:
        return {
            "done": None,
            "total": None,
            "fraction": None,
            "display": "N/A",
            "counter": "Roadmap items: N/A (scope is not enumerated)",
        }
    fraction = done / total
    pct = fraction * 100.0
    display = "<100%" if fraction < 1.0 and round(pct, 1) >= 100.0 else f"{pct:.1f}%"
    return {
        "done": done,
        "total": total,
        "fraction": fraction,
        "display": display,
        "counter": f"Roadmap items: {done}/{total} verified",
    }


def number(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError("non-finite SVG geometry")
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


def card(cfg: dict[str, object], data: dict[str, object]) -> str:
    fraction = data["fraction"]
    fill = ""
    if isinstance(fraction, float) and fraction > 0:
        fill_width = 1100.0 * fraction
        fill = f'  <rect id="progress-fill" x="50" y="138" width="{number(fill_width)}" height="18" rx="9" fill="url(#progressGradient)" filter="url(#softGlow)" clip-path="url(#trackClip)"/>\n'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="180" viewBox="0 0 1200 180" role="img" aria-labelledby="title desc">
  <title id="title">{esc(cfg['project'])} progress — {esc(data['display'])}</title>
  <desc id="desc">{esc(cfg['scope'])}. Status {esc(cfg['status'])}. {esc(data['counter'])}. Development progress and release readiness are separate gates.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#02050A"/><stop offset="1" stop-color="#07111C"/></linearGradient>
    <linearGradient id="progressGradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0088FF"/><stop offset="1" stop-color="#62E5FF"/></linearGradient>
    <filter id="softGlow" x="-10%" y="-80%" width="120%" height="260%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#62E5FF" stroke-opacity=".035" stroke-width="1"/></pattern>
    <clipPath id="trackClip"><rect x="50" y="138" width="1100" height="18" rx="9"/></clipPath>
  </defs>
  <rect x="1" y="1" width="1198" height="178" rx="22" fill="url(#bg)" stroke="#62E5FF" stroke-opacity=".28" stroke-width="2"/>
  <rect x="2" y="2" width="1196" height="176" rx="21" fill="url(#grid)"/>
  <text x="50" y="31" fill="#62E5FF" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="2">SWIR PROGRESS</text>
  <text x="50" y="68" fill="#F4FAFF" font-family="Segoe UI,Arial,sans-serif" font-size="28" font-weight="700">{esc(cfg['project'])}</text>
  <text x="50" y="96" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="15">{esc(cfg['scope'])}</text>
  <rect x="935" y="25" width="215" height="34" rx="17" fill="#07111C" stroke="#0088FF" stroke-opacity=".75"/>
  <text x="1042.5" y="47" text-anchor="middle" fill="#62E5FF" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700">{esc(cfg['status'])}</text>
  <text x="50" y="122" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="13">{esc(data['counter'])}</text>
  <text x="1150" y="122" text-anchor="end" fill="#F4FAFF" font-family="Segoe UI,Arial,sans-serif" font-size="24" font-weight="700">{esc(data['display'])}</text>
  <rect id="progress-track" x="50" y="138" width="1100" height="18" rx="9" fill="#0A1A28" stroke="#8DA8B8" stroke-opacity=".22"/>
{fill}  <text x="1150" y="171" text-anchor="end" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="10">Release readiness is tracked separately.</text>
</svg>
'''


def mini(cfg: dict[str, object], data: dict[str, object]) -> str:
    fraction = data["fraction"]
    fill = ""
    if isinstance(fraction, float) and fraction > 0:
        fill_width = 700.0 * fraction
        fill = f'  <rect id="progress-fill" x="170" y="45" width="{number(fill_width)}" height="12" rx="6" fill="url(#progressGradient)" clip-path="url(#trackClip)"/>\n'
    counter = "items N/A" if data["total"] is None else f"{data['done']}/{data['total']} items"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="72" viewBox="0 0 900 72" role="img" aria-labelledby="title desc">
  <title id="title">{esc(cfg['project'])} roadmap progress — {esc(data['display'])}</title>
  <desc id="desc">{esc(cfg['scope'])}. {esc(cfg['status'])}. {esc(data['counter'])}.</desc>
  <defs>
    <linearGradient id="progressGradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0088FF"/><stop offset="1" stop-color="#62E5FF"/></linearGradient>
    <clipPath id="trackClip"><rect x="170" y="45" width="700" height="12" rx="6"/></clipPath>
  </defs>
  <rect x="1" y="1" width="898" height="70" rx="16" fill="#02050A" stroke="#62E5FF" stroke-opacity=".25" stroke-width="2"/>
  <text x="18" y="27" fill="#F4FAFF" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="700">{esc(cfg['project'])}</text>
  <text x="190" y="27" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="12">{esc(cfg['scope'])}</text>
  <text x="565" y="27" fill="#62E5FF" font-family="Segoe UI,Arial,sans-serif" font-size="11" font-weight="700">{esc(cfg['status'])}</text>
  <text x="675" y="27" fill="#8DA8B8" font-family="Segoe UI,Arial,sans-serif" font-size="11">{esc(counter)}</text>
  <text x="870" y="27" text-anchor="end" fill="#F4FAFF" font-family="Segoe UI,Arial,sans-serif" font-size="15" font-weight="700">{esc(data['display'])}</text>
  <text x="18" y="56" fill="#62E5FF" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="700">SWIR</text>
  <rect id="progress-track" x="170" y="45" width="700" height="12" rx="6" fill="#07111C" stroke="#8DA8B8" stroke-opacity=".22"/>
{fill}</svg>
'''


def template() -> str:
    return '''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="180" viewBox="0 0 1200 180" role="img" aria-labelledby="title desc">
  <title id="title">SWIR Progress SVG template — not project data</title>
  <desc id="desc">Reusable visual template only. TEMPLATE / NOT PROJECT DATA. Do not embed this file as live project progress.</desc>
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#02050A"/><stop offset="1" stop-color="#07111C"/></linearGradient><pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#62E5FF" stroke-opacity=".035" stroke-width="1"/></pattern></defs>
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


def validate(text: str, fraction: float | None, track_width: float) -> None:
    for token in FORBIDDEN:
        if token in text:
            raise ValueError(f"forbidden SVG content: {token}")
    root = ET.fromstring(text)
    view_box = root.attrib.get("viewBox", "").split()
    if len(view_box) != 4 or any(not math.isfinite(float(part)) for part in view_box):
        raise ValueError("invalid viewBox")
    fill = None
    for element in root.iter():
        if element.attrib.get("id") == "progress-fill":
            fill = element
        for attr in ("x", "y", "width", "height", "rx"):
            raw = element.attrib.get(attr)
            if raw is None:
                continue
            try:
                value = float(raw)
            except ValueError:
                continue
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"invalid numeric geometry {attr}={raw}")
    if fraction is None or fraction == 0:
        if fill is not None:
            raise ValueError("N/A/zero progress must not render a fill")
    else:
        if fill is None:
            raise ValueError("progress fill missing")
        actual = float(fill.attrib["width"])
        expected = track_width * fraction
        if abs(actual - expected) > 0.001 or actual > track_width + 0.001:
            raise ValueError(f"progress geometry mismatch: {actual} != {expected}")


def expected_files(track: str) -> tuple[dict[Path, str], dict[str, object]]:
    cfg = CONFIG[track]
    data = measure(cfg)
    out = ROOT / str(cfg["output"])
    result = {
        out / "progress-card.svg": card(cfg, data),
        out / "progress-mini.svg": mini(cfg, data),
        out / "progress-template.svg": template(),
    }
    validate(result[out / "progress-card.svg"], data["fraction"], 1100.0)
    validate(result[out / "progress-mini.svg"], data["fraction"], 700.0)
    validate(result[out / "progress-template.svg"], None, 1100.0)
    return result, data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("track", choices=sorted(CONFIG))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    files, data = expected_files(args.track)
    stale: list[str] = []
    for path, content in files.items():
        if args.check:
            if not path.is_file() or path.read_text(encoding="utf-8") != content:
                stale.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
    if stale:
        print("SWIR progress SVG check failed; regenerate: " + ", ".join(stale), file=sys.stderr)
        return 1
    cfg = CONFIG[args.track]
    print(f"SWIR progress SVG {args.track}: {data['display']} • {data['counter']} • source={cfg['source']} • status={cfg['status']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
