#!/usr/bin/env python3
"""Read-only Bugsink client over its canonical API.

BUGSINK_URL and BUGSINK_API_TOKEN from the environment, ./.env of the project or ~/.config/bugsink/env.
Usage: bugsink.py projects | issues [project] [--all] | issue <uuid> | event <uuid>
"""
import json
from pathlib import Path
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deckenv  # noqa: E402

_env = deckenv.secrets(("BUGSINK_URL", "BUGSINK_API_TOKEN"), [".env", "~/.config/bugsink/env"])
BASE, TOKEN = _env["BUGSINK_URL"].rstrip("/"), _env["BUGSINK_API_TOKEN"]
CTX = deckenv.ssl_context()


def get(path, **params):
    url = path if path.startswith("http") else f"{BASE}/api/canonical/0/{path}"
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.load(r)


def get_all(path, limit=500, **params):
    data, out = get(path, **params), []
    while True:
        out += data.get("results", [])
        if not data.get("next") or len(out) >= limit:
            return out[:limit]
        data = get(data["next"])


def projects():
    return {p["id"]: p["name"] for p in get_all("projects/")}


def cmd_projects():
    for p in get_all("projects/"):
        print(f'{p["id"]:>3} {p["name"]:<24} events={p["stored_event_count"]}')


def cmd_issues(project=None, show_all=False):
    names = projects()
    ids = [int(project)] if project and project.isdigit() else \
        [i for i, n in names.items() if not project or n == project]
    rows = []
    for pid in ids:
        rows += [i for i in get_all("issues/", project=pid)
                 if show_all or not (i["is_resolved"] or i["is_muted"])]
    rows.sort(key=lambda i: i["last_seen"], reverse=True)
    for i in rows:
        state = "resolved" if i["is_resolved"] else "muted" if i["is_muted"] else "open"
        print(f'{i["friendly_id"]:<16} {state:<8} n={i["digested_event_count"]:<5} '
              f'last={i["last_seen"][:16]} {names.get(i["project"], i["project"])}: '
              f'{i["calculated_type"]}: {i["calculated_value"][:120]}  id={i["id"]}')


def cmd_issue(issue_id):
    print(json.dumps(get(f"issues/{issue_id}/"), ensure_ascii=False, indent=1))
    events = get("events/", issue=issue_id)["results"][:10]
    print("last events:", *[f'{e["timestamp"][:19]} {e["id"]}' for e in events], sep="\n  ")


def cmd_event(event_id):
    print(json.dumps(get(f"events/{event_id}/"), ensure_ascii=False, indent=1)[:20000])


def main(argv):
    cmds = {"projects": cmd_projects, "issues": cmd_issues, "issue": cmd_issue, "event": cmd_event}
    if not argv or argv[0] not in cmds:
        sys.exit("usage: bugsink.py projects | issues [project] [--all] | issue <uuid> | event <uuid>")
    show_all = "--all" in argv
    args = [a for a in argv[1:] if a != "--all"]
    if argv[0] == "issues":
        return cmd_issues(*(args[:1]), show_all=show_all)
    cmds[argv[0]](*args)


if __name__ == "__main__":
    main(sys.argv[1:])
