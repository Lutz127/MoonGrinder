from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import html
import json
import os
import platform
import random
import re
import secrets
import string
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HOST = "127.0.0.1"
PORT = 17381
SITE_URL = "https://lutz127.github.io/MoonGrinder/#/gd-lists"
GD_UPLOAD_URL = "https://www.boomlings.com/database/uploadGJLevelList.php"
GD_SECRET = "Wmfd2893gb7"
GAME_VERSION = 22
BINARY_VERSION = 47
MAX_LIST_LEVELS = 100
MAX_BODY_BYTES = 128 * 1024

ALLOWED_PUBLIC_ORIGINS = {"https://lutz127.github.io"}


def default_save_path() -> Path | None:
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA")
        return Path(base) / "GeometryDash" / "CCGameManager.dat" if base else None
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "GeometryDash" / "CCGameManager.dat"
    return None


def decode_save(path: Path) -> bytes:
    raw = path.read_bytes()
    stripped = raw.lstrip()
    if stripped.startswith((b"<?xml", b"<plist")):
        return raw
    xored = bytes(value ^ 11 for value in raw)
    compact = re.sub(rb"\s+", b"", xored)
    compact += b"=" * ((4 - len(compact) % 4) % 4)
    decoded = base64.urlsafe_b64decode(compact)
    return gzip.decompress(decoded)


def xml_scalar(xml: bytes, key: str) -> str | None:
    escaped = re.escape(key.encode("utf-8"))
    patterns = [
        rb"<k>" + escaped + rb"</k>\s*<s>(.*?)</s>",
        rb"<k>" + escaped + rb"</k>\s*<string>(.*?)</string>",
        rb"<k>" + escaped + rb"</k>\s*<i>(.*?)</i>",
        rb"<k>" + escaped + rb"</k>\s*<integer>(.*?)</integer>",
        rb"<k>" + escaped + rb"</k>\s*<r>(.*?)</r>",
        rb"<k>" + escaped + rb"</k>\s*<real>(.*?)</real>",
    ]
    for pattern in patterns:
        match = re.search(pattern, xml, flags=re.DOTALL)
        if match:
            return html.unescape(match.group(1).decode("utf-8", errors="replace")).strip()
    return None


def load_gd_auth(save_path: Path) -> dict[str, str]:
    xml = decode_save(save_path)
    account_id = xml_scalar(xml, "GJA_003")
    gjp2 = xml_scalar(xml, "GJA_005")
    username = xml_scalar(xml, "GJA_001") or xml_scalar(xml, "playerName") or ""
    user_id = xml_scalar(xml, "playerUserID") or ""
    udid = xml_scalar(xml, "playerUDID") or ""

    if not account_id or not account_id.isdigit():
        raise RuntimeError("Could not read the Geometry Dash Account ID from CCGameManager.dat.")
    if not gjp2:
        raise RuntimeError("Could not read GJP2 from CCGameManager.dat. Make sure you are logged into a Geometry Dash account.")

    return {
        "account_id": account_id,
        "gjp2": gjp2,
        "username": username,
        "user_id": user_id,
        "udid": udid,
    }


def cyclic_xor(text: str, key: str) -> str:
    return "".join(chr(ord(ch) ^ ord(key[index % len(key)])) for index, ch in enumerate(text))


def upload_seed_sample(level_string: str, chars: int = 50) -> str:
    # Keep this compatible with the MoonGrinder maintainer uploader that has
    # already been used against the current list-upload endpoint.
    if len(level_string) <= chars:
        return level_string
    step = max(1, len(level_string) // chars)
    return level_string[::step][:chars]


def make_list_seed(level_ids_csv: str, account_id: str, seed2: str) -> str:
    sampled = upload_seed_sample(level_ids_csv, 50)
    digest = hashlib.sha1((sampled + str(account_id)).encode("utf-8")).hexdigest()
    xored = cyclic_xor(digest, seed2)
    return base64.urlsafe_b64encode(xored.encode("latin1")).decode("ascii")


def b64_url_text(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii")


def post_form(url: str, fields: dict[str, Any], timeout: int = 30) -> str:
    body = urllib.parse.urlencode({key: str(value) for key, value in fields.items()}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "User-Agent": "",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8", errors="replace").strip()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Geometry Dash returned HTTP {exc.code}: {detail or exc.reason}") from exc


def upload_list(auth: dict[str, str], payload: dict[str, Any]) -> int:
    raw_ids = payload.get("levelIds")
    if not isinstance(raw_ids, list):
        raise ValueError("levelIds must be an array.")

    level_ids: list[str] = []
    seen: set[str] = set()
    for raw in raw_ids:
        value = str(raw).strip()
        if not value.isdigit() or int(value) <= 0:
            raise ValueError(f"Invalid Level ID: {value!r}")
        if value not in seen:
            seen.add(value)
            level_ids.append(value)

    if not level_ids:
        raise ValueError("The list has no levels.")
    if len(level_ids) > MAX_LIST_LEVELS:
        raise ValueError("Geometry Dash lists can contain at most 100 levels.")

    list_name = str(payload.get("listName") or "").strip()
    list_desc = str(payload.get("listDesc") or "").strip()
    if not list_name:
        raise ValueError("List name cannot be empty.")
    if len(list_name) > 24:
        raise ValueError("Keep the list name at 24 characters or fewer.")
    if len(list_desc) > 180:
        raise ValueError("Keep the description at 180 characters or fewer.")

    try:
        difficulty = int(payload.get("difficulty", -1))
        visibility = int(payload.get("unlisted", 0))
        list_id = int(payload.get("listID", 0) or 0)
        original = int(payload.get("original", 0) or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("List ID, original ID, difficulty, and visibility must be numbers.") from exc

    if difficulty < -1 or difficulty > 10:
        raise ValueError("List difficulty must be between -1 and 10.")
    if visibility not in {0, 1, 2}:
        raise ValueError("Visibility must be Public, Friends only, or Unlisted.")
    if list_id < 0 or original < 0:
        raise ValueError("List IDs cannot be negative.")

    list_levels = ",".join(level_ids)
    seed2 = "".join(random.choice(string.ascii_letters + string.digits) for _ in range(5))
    seed = make_list_seed(list_levels, auth["account_id"], seed2)

    dvs = 8 if sys.platform == "darwin" else 3
    fields: dict[str, Any] = {
        "gameVersion": GAME_VERSION,
        "binaryVersion": BINARY_VERSION,
        "accountID": auth["account_id"],
        "gjp2": auth["gjp2"],
        "listID": list_id,
        "listName": list_name,
        "listDesc": b64_url_text(list_desc),
        "listLevels": list_levels,
        "difficulty": difficulty,
        "listVersion": 0,
        "original": original,
        "unlisted": visibility,
        "seed": seed,
        "seed2": seed2,
        "secret": GD_SECRET,
        "dvs": dvs,
    }
    if auth.get("user_id"):
        fields["uuid"] = auth["user_id"]
    if auth.get("udid"):
        fields["udid"] = auth["udid"]

    response = post_form(GD_UPLOAD_URL, fields)
    if not re.fullmatch(r"-?\d+", response):
        raise RuntimeError(f"Geometry Dash returned an unexpected response: {response!r}")
    returned_id = int(response)
    if returned_id <= 0:
        raise RuntimeError(f"Geometry Dash rejected the list upload. Server response: {response}")
    return returned_id


def origin_allowed(origin: str | None) -> bool:
    if not origin:
        return True
    if origin in ALLOWED_PUBLIC_ORIGINS:
        return True
    return bool(re.fullmatch(r"http://(?:localhost|127\.0\.0\.1)(?::\d+)?", origin))


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    auth: dict[str, str]
    session_token: str


class Handler(BaseHTTPRequestHandler):
    server: BridgeServer

    def log_message(self, fmt: str, *args: Any) -> None:
        # Avoid printing request bodies or authentication material. Normal
        # access lines are not useful for this tiny local helper.
        return

    def _origin(self) -> str | None:
        return self.headers.get("Origin")

    def _cors_headers(self) -> None:
        origin = self._origin()
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-MoonGrinder-Token")
        # Harmless on browsers using the newer Local Network Access permission
        # model, and keeps the helper compatible with PNA-style preflights.
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, status: int, data: dict[str, Any]) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _reject_origin(self) -> bool:
        if origin_allowed(self._origin()):
            return False
        self._json(403, {"ok": False, "error": "This local helper only accepts MoonGrinder and localhost origins."})
        return True

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self._reject_origin():
            return
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self._reject_origin():
            return
        if self.path.rstrip("/") != "/status":
            self._json(404, {"ok": False, "error": "Not found."})
            return
        self._json(200, {
            "ok": True,
            "token": self.server.session_token,
            "username": self.server.auth.get("username", ""),
            "platform": platform.system(),
        })

    def do_POST(self) -> None:  # noqa: N802
        if self._reject_origin():
            return
        if self.path.rstrip("/") != "/upload":
            self._json(404, {"ok": False, "error": "Not found."})
            return
        if self.headers.get("X-MoonGrinder-Token") != self.server.session_token:
            self._json(403, {"ok": False, "error": "The local uploader session changed. Reconnect and try again."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._json(400, {"ok": False, "error": "Invalid request size."})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Request body must be a JSON object.")
            list_id = upload_list(self.server.auth, payload)
            self._json(200, {"ok": True, "listID": list_id})
            print(f"Uploaded Geometry Dash list {list_id} with {len(payload.get('levelIds') or [])} levels.")
        except Exception as exc:
            self._json(400, {"ok": False, "error": str(exc)})
            print(f"List upload failed: {exc}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local upload bridge for MoonGrinder Geometry Dash Lists.")
    parser.add_argument("--save", type=Path, help="Path to CCGameManager.dat if it is not in the normal location.")
    parser.add_argument("--port", type=int, default=PORT, help=f"Local port to use (default {PORT}).")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the MoonGrinder website automatically.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    save_path = (args.save or default_save_path())
    if not save_path:
        print("Could not determine your Geometry Dash save location.")
        print("Run this again with: python tools/gd_list_bridge.py --save \"/path/to/CCGameManager.dat\"")
        return 2
    save_path = save_path.expanduser().resolve()
    if not save_path.exists():
        print(f"Geometry Dash save not found: {save_path}")
        print("Use --save PATH if your CCGameManager.dat is somewhere else.")
        return 2

    try:
        auth = load_gd_auth(save_path)
    except Exception as exc:
        print(f"Could not load Geometry Dash account data: {exc}")
        return 2

    server = BridgeServer((HOST, int(args.port)), Handler)
    server.auth = auth
    server.session_token = secrets.token_urlsafe(24)

    print("MoonGrinder GD List uploader is running.")
    if auth.get("username"):
        print(f"Geometry Dash account: {auth['username']}")
    print(f"Local address: http://{HOST}:{args.port}")
    print("GJP2 stays inside this process and is never returned to the browser.")
    print("Keep this window open while uploading lists. Press Ctrl+C to stop.")

    if not args.no_browser and int(args.port) == PORT:
        threading.Timer(0.6, lambda: webbrowser.open(SITE_URL)).start()

    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nStopping MoonGrinder GD List uploader.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
