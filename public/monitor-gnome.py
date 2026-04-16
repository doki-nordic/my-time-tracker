#!/usr/bin/env python3
"""Monitor GNOME lock/screen-saver state and forward events to msg_send.php.

Usage:
  python3 monitor-gnome.py <base_url> <uid>

Example:
  python3 monitor-gnome.py http://localhost:8080/ CHANGE_ME_TO_RANDOM
"""

from __future__ import annotations

import re
import select
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from typing import Optional


DBUS_FILTER = "type='signal',interface='org.gnome.ScreenSaver'"
EVENT_RE = re.compile(r"boolean\s+(true|false)", re.IGNORECASE)
KEEPALIVE_SECONDS = 60


def usage() -> None:
    print("Usage: python3 monitor-gnome.py <base_url> <uid>")
    print("Example: python3 monitor-gnome.py http://localhost:8080/ CHANGE_ME_TO_RANDOM")


def normalize_base_url(raw_url: str) -> str:
    base = raw_url.strip()
    if not base:
        raise ValueError("Base URL is empty")
    if not (base.startswith("http://") or base.startswith("https://")):
        raise ValueError("Base URL must start with http:// or https://")
    if not base.endswith("/"):
        base += "/"
    return base


def send_message(base_url: str, uid: str, message: str, timeout: float = 10.0) -> bool:
    body = urllib.parse.urlencode({"uid": uid, "message": message}).encode("utf-8")
    req = urllib.request.Request(
        urllib.parse.urljoin(base_url, "msg_send.php"),
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            payload = res.read().decode("utf-8", errors="replace").strip()
            ok = 200 <= res.status < 300 and payload == "OK"
            if ok:
                print(f"[monitor] sent: {message}")
            else:
                print(
                    f"[monitor] send failed: status={res.status}, response={payload}",
                    file=sys.stderr,
                )
            return ok
    except Exception as exc:
        print(f"[monitor] send failed: {exc}", file=sys.stderr)
        return False


def state_to_message(locked: bool) -> str:
    return "locked" if locked else "unlocked"


def monitor_loop(base_url: str, uid: str) -> int:
    try:
        proc = subprocess.Popen(
            ["dbus-monitor", "--session", DBUS_FILTER],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        print("Error: dbus-monitor not found. Install package dbus.", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Error: failed to start dbus-monitor: {exc}", file=sys.stderr)
        return 1

    if proc.stdout is None:
        print("Error: failed to read dbus-monitor output", file=sys.stderr)
        proc.terminate()
        return 1

    changing_state = False
    locked_state: bool = False

    send_message(base_url, uid, state_to_message(locked_state))
    last_sent = time.monotonic()

    print("[monitor] started. Press Ctrl+C to stop.")

    try:
        while True:
            if proc.poll() is not None:
                print(
                    f"[monitor] dbus-monitor exited with code {proc.returncode}",
                    file=sys.stderr,
                )
                return 1

            ready, _, _ = select.select([proc.stdout], [], [], 1.0)
            if ready:
                line = proc.stdout.readline()
                if line == "":
                    continue

                if "member=ActiveChanged" in line:
                    changing_state = True
                else:
                    match = EVENT_RE.search(line) if changing_state else None
                    if match is not None:
                        locked_state = match.group(1).lower() == "true"
                        changing_state = False
                        send_message(base_url, uid, state_to_message(locked_state))
                        last_sent = time.monotonic()
                    else:
                        changing_state = False

            now = time.monotonic()
            if now - last_sent >= KEEPALIVE_SECONDS:
                send_message(base_url, uid, state_to_message(locked_state))
                last_sent = now

    except KeyboardInterrupt:
        print("\n[monitor] stopping...")
        return 0
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()


def main() -> int:
    if len(sys.argv) != 3:
        usage()
        return 1

    try:
        base_url = normalize_base_url(sys.argv[1])
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        usage()
        return 1

    uid = sys.argv[2].strip()
    if not uid:
        print("Error: uid must not be empty", file=sys.stderr)
        usage()
        return 1

    return monitor_loop(base_url, uid)


if __name__ == "__main__":
    raise SystemExit(main())
