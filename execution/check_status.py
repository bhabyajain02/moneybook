#!/usr/bin/env python3
"""
check_status.py — MoneyBook Project Status Checker
----------------------------------------------------
Checks:
  1. Is the Render backend live? (pings health endpoint)
  2. Are APK build files present? (debug + release)
  3. Is the backend URL correctly set in .env and src/api.js?
  4. Auto-injects the URL into .env and api.js if it's missing or wrong.

Usage:
  python execution/check_status.py
  python execution/check_status.py --fix   # auto-fix URL mismatches
"""

import os
import sys
import re
import requests
import argparse
from datetime import datetime
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

RENDER_URL = "https://moneybook-1.onrender.com"
PROJECT_ROOT = Path(__file__).parent.parent          # moneybook/
FRONTEND_DIR = PROJECT_ROOT / "frontend"
ENV_FILE     = FRONTEND_DIR / ".env"
API_FILE     = FRONTEND_DIR / "src" / "api.js"
ANDROID_DIR  = FRONTEND_DIR / "android"

APK_PATHS = {
    "release": ANDROID_DIR / "app" / "release" / "app-release.apk",
    "debug":   ANDROID_DIR / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def green(s):  return f"\033[92m{s}\033[0m"
def red(s):    return f"\033[91m{s}\033[0m"
def yellow(s): return f"\033[93m{s}\033[0m"
def bold(s):   return f"\033[1m{s}\033[0m"
def cyan(s):   return f"\033[96m{s}\033[0m"

def fmt_size(path: Path) -> str:
    size = path.stat().st_size
    if size >= 1_048_576:
        return f"{size / 1_048_576:.1f} MB"
    elif size >= 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size} B"

def fmt_mtime(path: Path) -> str:
    ts = path.stat().st_mtime
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")

# ── Check 1: Render Backend ───────────────────────────────────────────────────

def check_backend() -> dict:
    print(bold("\n🌐  Render Backend"))
    print(f"    URL: {cyan(RENDER_URL)}")

    try:
        resp = requests.get(RENDER_URL + "/api/health", timeout=10)
        if resp.status_code == 200:
            print(f"    Status: {green('✅  LIVE')}  (HTTP {resp.status_code})")
            return {"live": True, "status": resp.status_code}
        else:
            print(f"    Status: {yellow(f'⚠️  Responded with HTTP {resp.status_code}')}")
            return {"live": False, "status": resp.status_code}
    except requests.exceptions.Timeout:
        print(f"    Status: {red('❌  TIMEOUT')} — backend may be sleeping (Render free tier spins down)")
        print(f"    Tip: open {RENDER_URL} in browser to wake it up, then re-run this script")
        return {"live": False, "error": "timeout"}
    except requests.exceptions.ConnectionError as e:
        err = str(e)
        if "ProxyError" in err or "403 Forbidden" in err:
            print(f"    Status: {yellow('⚠️  PROXY / NETWORK RESTRICTED')} — run this on your own machine")
            print(f"    Tip: open {RENDER_URL} in your browser to verify manually")
            return {"live": None, "error": "proxy"}
        print(f"    Status: {red('❌  CONNECTION ERROR')} — {e}")
        return {"live": False, "error": str(e)}

# ── Check 2: APK Build Files ──────────────────────────────────────────────────

def check_apks() -> dict:
    print(bold("\n📦  Android APK Builds"))
    results = {}

    for build_type, apk_path in APK_PATHS.items():
        if apk_path.exists():
            size  = fmt_size(apk_path)
            mtime = fmt_mtime(apk_path)
            print(f"    [{build_type:7s}] {green('✅  Found')}  │  {size}  │  Built: {mtime}")
            print(f"              {apk_path}")
            results[build_type] = {"found": True, "path": str(apk_path), "size": size, "built_at": mtime}
        else:
            print(f"    [{build_type:7s}] {red('❌  Missing')}  →  {apk_path}")
            if build_type == "debug":
                print(f"             Run in Android Studio: Build → Build Bundle(s) / APK(s) → Build APK(s)")
            else:
                print(f"             Run in Android Studio: Build → Generate Signed Bundle / APK → APK")
            results[build_type] = {"found": False}

    return results

# ── Check 3 + Fix: Backend URL in config files ────────────────────────────────

def check_url_in_env(fix: bool) -> dict:
    if not ENV_FILE.exists():
        print(f"    {red('❌  .env not found')}: {ENV_FILE}")
        return {"ok": False, "error": "missing"}

    content = ENV_FILE.read_text()
    match = re.search(r"VITE_API_URL\s*=\s*(.+)", content)

    if match:
        current = match.group(1).strip()
        if current == RENDER_URL:
            print(f"    .env          {green('✅  Correct')}  →  VITE_API_URL={current}")
            return {"ok": True, "value": current}
        else:
            print(f"    .env          {yellow('⚠️  Mismatch')}  →  found: {current}")
            print(f"                                    expected: {RENDER_URL}")
            if fix:
                new_content = re.sub(
                    r"VITE_API_URL\s*=\s*.+",
                    f"VITE_API_URL={RENDER_URL}",
                    content
                )
                ENV_FILE.write_text(new_content)
                print(f"                  {green('🔧  Fixed!')} VITE_API_URL updated")
                return {"ok": True, "fixed": True}
            return {"ok": False, "value": current}
    else:
        print(f"    .env          {yellow('⚠️  VITE_API_URL not set')}")
        if fix:
            ENV_FILE.write_text(content.rstrip() + f"\nVITE_API_URL={RENDER_URL}\n")
            print(f"                  {green('🔧  Fixed!')} VITE_API_URL added to .env")
            return {"ok": True, "fixed": True}
        return {"ok": False, "error": "missing_key"}


def check_url_in_api(fix: bool) -> dict:
    if not API_FILE.exists():
        print(f"    {red('❌  api.js not found')}: {API_FILE}")
        return {"ok": False, "error": "missing"}

    content = API_FILE.read_text()
    match = re.search(r'const BACKEND_URL\s*=\s*["\'](.+?)["\']', content)

    if match:
        current = match.group(1).strip()
        if current == RENDER_URL:
            print(f"    src/api.js    {green('✅  Correct')}  →  BACKEND_URL={current}")
            return {"ok": True, "value": current}
        else:
            print(f"    src/api.js    {yellow('⚠️  Mismatch')}  →  found: {current}")
            print(f"                                    expected: {RENDER_URL}")
            if fix:
                new_content = re.sub(
                    r'const BACKEND_URL\s*=\s*["\'].+?["\']',
                    f'const BACKEND_URL = "{RENDER_URL}"',
                    content
                )
                API_FILE.write_text(new_content)
                print(f"                  {green('🔧  Fixed!')} BACKEND_URL updated in api.js")
                return {"ok": True, "fixed": True}
            return {"ok": False, "value": current}
    else:
        print(f"    src/api.js    {yellow('⚠️  BACKEND_URL constant not found')}")
        return {"ok": False, "error": "not_found"}


def check_config(fix: bool) -> dict:
    print(bold("\n🔗  Backend URL in Config Files"))
    env_result = check_url_in_env(fix)
    api_result = check_url_in_api(fix)
    return {"env": env_result, "api": api_result}

# ── Summary ───────────────────────────────────────────────────────────────────

def print_summary(backend, apks, config):
    print(bold("\n" + "─" * 55))
    print(bold("📊  Summary"))
    print("─" * 55)

    backend_live = backend.get("live")  # True / False / None (proxy/unknown)
    apk_ok    = any(v.get("found") for v in apks.values())
    config_ok = config["env"].get("ok") and config["api"].get("ok")

    # Backend icon
    if backend_live is True:
        b_icon = green("✅")
        b_label = "Render backend live"
    elif backend_live is None:
        b_icon = yellow("⚠️ ")
        b_label = "Render backend (could not check — verify in browser)"
    else:
        b_icon = red("❌")
        b_label = "Render backend live"

    rows = [
        (b_icon, b_label),
        (green("✅") if apk_ok    else red("❌"), "APK build present"),
        (green("✅") if config_ok else red("❌"), "Config URLs correct"),
    ]

    all_ok = backend_live is not False and apk_ok and config_ok

    for icon, label in rows:
        print(f"  {icon}  {label}")

    print("─" * 55)
    if all_ok:
        print(green("  🚀  Everything looks good! Ready to run on Android."))
    else:
        print(yellow("  ⚠️  Some issues found above. Fix them and re-run."))
        if not backend_live:
            print(yellow("     • Backend: check Render dashboard or wake it via browser"))
        if not apk_ok:
            print(yellow("     • APK: build it from Android Studio"))
        if not config_ok:
            print(yellow("     • Config: run with --fix to auto-correct URLs"))

    print()

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="MoneyBook project status checker")
    parser.add_argument("--fix", action="store_true", help="Auto-fix URL mismatches in config files")
    args = parser.parse_args()

    print(bold(cyan("\n╔══════════════════════════════════════════════════════╗")))
    print(bold(cyan("║        MoneyBook — Project Status Checker            ║")))
    print(bold(cyan("╚══════════════════════════════════════════════════════╝")))
    print(f"  Render URL : {RENDER_URL}")
    print(f"  Project    : {PROJECT_ROOT}")
    print(f"  Mode       : {'--fix (auto-correct)' if args.fix else 'read-only (add --fix to auto-correct)'}")

    backend = check_backend()
    apks    = check_apks()
    config  = check_config(fix=args.fix)

    print_summary(backend, apks, config)

if __name__ == "__main__":
    main()
