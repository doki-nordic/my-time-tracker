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
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


DBUS_FILTER = "type='signal',interface='org.gnome.ScreenSaver'"
EVENT_RE = re.compile(r"boolean\s+(true|false)", re.IGNORECASE)
KEEPALIVE_SECONDS = 60


def ts() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def log(msg: str) -> None:
    print(f"[{ts()}] [monitor] {msg}")


def log_err(msg: str) -> None:
    print(f"[{ts()}] [monitor] {msg}", file=sys.stderr)


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
    target_url = urllib.parse.urljoin(base_url, "msg_send.php")
    body = urllib.parse.urlencode({"uid": uid, "message": message}).encode("utf-8")
    req = urllib.request.Request(
        target_url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            payload = res.read().decode("utf-8", errors="replace").strip()
            ok = 200 <= res.status < 300 and payload == "OK"
            if ok:
                log(f"sent: {message}")
            else:
                log_err(f"send failed: status={res.status}, response={payload}")
            return ok
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, socket.gaierror):
            log_err(
                f"send failed: could not resolve host in {target_url} ({reason}). "
                "Check the domain name in <base_url>."
            )
        else:
            log_err(f"send failed for {target_url}: {exc}")
        return False
    except Exception as exc:
        log_err(f"send failed for {target_url}: {exc}")
        return False


def state_to_message(locked: bool) -> str:
    return "locked" if locked else "unlocked"


def parse_active_changed_block(lines: list[str]) -> bool | None:
    if not lines:
        return None
    if not any("member=ActiveChanged" in line for line in lines):
        return None

    for line in lines:
        match = EVENT_RE.search(line)
        if match is not None:
            return match.group(1).lower() == "true"
    return None


def handle_parsed_block(lines: list[str], locked_state: bool, base_url: str, uid: str) -> tuple[bool, bool]:
    next_state = parse_active_changed_block(lines)
    if next_state is None or next_state == locked_state:
        return locked_state, False

    locked_state = next_state
    send_message(base_url, uid, state_to_message(locked_state))
    return locked_state, True


def monitor_loop(base_url: str, uid: str) -> int:
    try:
        cmd = ["dbus-monitor", "--session", DBUS_FILTER]
        # dbus-monitor may be block-buffered on pipes; stdbuf improves event latency.
        if shutil.which("stdbuf"):
            cmd = ["stdbuf", "-oL", "-eL", *cmd]

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        log_err("Error: dbus-monitor not found. Install package dbus.")
        return 1
    except Exception as exc:
        log_err(f"Error: failed to start dbus-monitor: {exc}")
        return 1

    if proc.stdout is None:
        log_err("Error: failed to read dbus-monitor output")
        proc.terminate()
        return 1

    locked_state: bool = False
    pending_lines: list[str] = []

    send_message(base_url, uid, state_to_message(locked_state))
    last_sent = time.monotonic()

    log("started. Press Ctrl+C to stop.")

    try:
        while True:
            if proc.poll() is not None:
                log_err(f"dbus-monitor exited with code {proc.returncode}")
                return 1

            ready, _, _ = select.select([proc.stdout], [], [], 1.0)
            if ready:
                line = proc.stdout.readline()
                if line == "":
                    continue

                line = line.rstrip("\n")
                if line.startswith("signal "):
                    if pending_lines:
                        locked_state, changed = handle_parsed_block(
                            pending_lines,
                            locked_state,
                            base_url,
                            uid,
                        )
                        if changed:
                            last_sent = time.monotonic()
                    pending_lines = [line]
                elif line == "":
                    if pending_lines:
                        locked_state, changed = handle_parsed_block(
                            pending_lines,
                            locked_state,
                            base_url,
                            uid,
                        )
                        if changed:
                            last_sent = time.monotonic()
                    pending_lines = []
                else:
                    pending_lines.append(line)

            now = time.monotonic()
            if now - last_sent >= KEEPALIVE_SECONDS:
                send_message(base_url, uid, state_to_message(locked_state))
                last_sent = now

    except KeyboardInterrupt:
        print()
        log("stopping...")
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
        log_err(f"Error: {exc}")
        usage()
        return 1

    uid = sys.argv[2].strip()
    if not uid:
        log_err("Error: uid must not be empty")
        usage()
        return 1

    return monitor_loop(base_url, uid)


if __name__ == "__main__":
    raise SystemExit(main())
