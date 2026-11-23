#!/usr/bin/env python3
"""Read-only Beszel client (PocketBase REST API).

Credentials: BESZEL_URL / BESZEL_EMAIL / BESZEL_PASSWORD, looked up in the
process env, then ./.env of the current project, then ~/.config/beszel/env —
so the same script serves every project without copying secrets around.

Usage:
  beszel.py systems                 status + load of every visible system
  beszel.py containers [system]     containers sorted by memory, heaviest first
  beszel.py stats <system> [type]   recent stats rows (type: 1m|10m|20m|120m|480m)
  beszel.py alerts                  alert rules and recent alert history
  beszel.py raw <collection> [n]    dump records as-is (field discovery)
"""
import json
import os
import ssl
import sys
import urllib.parse
import urllib.request
from pathlib import Path

# --admin switches to the full-rights user (BESZEL_ADMIN_EMAIL / _PASSWORD).
ADMIN = "--admin" in sys.argv
if ADMIN:
    sys.argv.remove("--admin")
PREFIX = "BESZEL_ADMIN_" if ADMIN else "BESZEL_"
KEYS = ("BESZEL_URL", f"{PREFIX}EMAIL", f"{PREFIX}PASSWORD")
ENV_FILES = (Path.cwd() / ".env", Path.home() / ".config/beszel/env")
# python.org builds on macOS ship without a CA store until "Install
# Certificates" is run; the system bundle is always there.
SYSTEM_CA = Path("/etc/ssl/cert.pem")


def create_ssl_context() -> ssl.SSLContext:
    if ssl.get_default_verify_paths().cafile is None and SYSTEM_CA.is_file():
        return ssl.create_default_context(cafile=str(SYSTEM_CA))
    return ssl.create_default_context()


def load_credentials() -> dict[str, str]:
    creds = {k: os.environ[k] for k in KEYS if os.environ.get(k)}
    for path in ENV_FILES:
        if len(creds) == len(KEYS) or not path.is_file():
            continue
        for line in path.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() in KEYS:
                creds.setdefault(key.strip(), value.strip().strip("'\""))
    missing = [k for k in KEYS if k not in creds]
    if missing:
        sys.exit(f"missing credentials: {', '.join(missing)}")
    return creds


class Beszel:
    def __init__(self, creds: dict[str, str]) -> None:
        self.base = creds["BESZEL_URL"].rstrip("/")
        self.token = ""
        self.ssl = create_ssl_context()
        body = {"identity": creds[f"{PREFIX}EMAIL"], "password": creds[f"{PREFIX}PASSWORD"]}
        self.token = self._call("/api/collections/users/auth-with-password", body)["token"]

    def records(self, collection: str, **params: str | int) -> list[dict]:
        query = urllib.parse.urlencode({"perPage": 200, **params})
        return self._call(f"/api/collections/{collection}/records?{query}")["items"]

    def _call(self, path: str, body: dict | None = None) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = self.token
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=20, context=self.ssl) as resp:
            return json.load(resp)


def find_system_id(api: Beszel, name: str) -> str:
    for system in api.records("systems"):
        if name in (system["name"], system["id"]):
            return system["id"]
    sys.exit(f"system not found (or not shared with this user): {name}")


def show_systems(api: Beszel) -> None:
    systems = api.records("systems", sort="name")
    if not systems:
        print("no systems visible — share them with this user in Beszel")
    for s in systems:
        info = s.get("info") or {}
        print(
            f"{s['name']:24} {s['status']:8} cpu={info.get('cpu')}% "
            f"mem={info.get('mp')}% disk={info.get('dp')}% agent={info.get('v')} "
            f"updated={s.get('updated')}"
        )


def show_containers(api: Beszel, name: str = "") -> None:
    params = {"filter": f"system='{find_system_id(api, name)}'"} if name else {}
    rows = sorted(api.records("containers", **params), key=lambda c: -(c.get("memory") or 0))
    for c in rows:
        # Swarm appends ".<replica>.<task id>" — strip it to get the app name.
        print(f'{c["name"].split(".", 1)[0]:45} mem={c.get("memory")}MB cpu={c.get("cpu")}% '
              f'health={c.get("health")} {c.get("status")}')


def show_stats(api: Beszel, name: str, kind: str = "10m") -> None:
    system_id = find_system_id(api, name)
    flt = f"system='{system_id}' && type='{kind}'"
    for row in api.records("system_stats", filter=flt, sort="-created", perPage=12):
        print(row["created"], json.dumps(row.get("stats"), ensure_ascii=False))


def show_alerts(api: Beszel) -> None:
    names = {s["id"]: s["name"] for s in api.records("systems")}
    print("== rules")
    for a in api.records("alerts"):
        print(names.get(a.get("system"), a.get("system")), a.get("name"),
              "value", a.get("value"), "triggered" if a.get("triggered") else "ok")
    print("== history (latest 20)")
    for h in api.records("alerts_history", sort="-created", perPage=20):
        print(h.get("created"), names.get(h.get("system"), h.get("system")),
              h.get("name"), h.get("value"), "resolved" if h.get("resolved") else "ACTIVE")


def show_raw(api: Beszel, collection: str, limit: str = "1") -> None:
    print(json.dumps(api.records(collection, perPage=int(limit)), ensure_ascii=False, indent=1))


COMMANDS = {"systems": show_systems, "containers": show_containers, "stats": show_stats, "alerts": show_alerts, "raw": show_raw}


def main() -> None:
    cmd, *args = sys.argv[1:] or ["systems"]
    if cmd not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[cmd](Beszel(load_credentials()), *args)


if __name__ == "__main__":
    main()
