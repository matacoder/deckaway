#!/usr/bin/env python3
"""Container logs from VictoriaLogs (set up by deck-server), read-only.

  logs.py query '<LogsQL>' [--since 1h] [--limit 200] [--raw]
  logs.py containers [--since 1h]                 # which containers wrote, with line counts

Examples: logs.py query 'error' --since 30m; logs.py query 'container_name:~"web" AND status:500'.
VICTORIALOGS_URL (and VICTORIALOGS_USER/PASSWORD for basic auth) from the environment, the env file named by the
profile's `victorialogs` source, ./.env or ~/.config/victorialogs/env. Emails, phones and long tokens are masked.
"""
import argparse
import base64
import json
from pathlib import Path
import re
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deckenv  # noqa: E402

PRIVATE = [(re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+'), '<email>'),
           (re.compile(r'(?<!\d)\+?\d[\d ()-]{9,}\d'), '<phone>'),
           (re.compile(r'(?i)(bearer|token|password|secret|key)([=: ]+)\S+'), r'\1\2***'),
           (re.compile(r'\b[A-Za-z0-9_-]{32,}\b'), '<token>')]
NAME = ('container_name', 'com.docker.swarm.service.name', 'service', '_stream')


def files():
    named = [s.get('env') for s in deckenv.profile().get('sources', []) if s.get('kind') == 'victorialogs']
    return [*filter(None, named), '.env', '~/.config/victorialogs/env']


def ask(path, params):
    env = deckenv.secrets(('VICTORIALOGS_URL',), files(), optional=('VICTORIALOGS_USER', 'VICTORIALOGS_PASSWORD'))
    headers = {}
    if env['VICTORIALOGS_USER']:
        pair = f"{env['VICTORIALOGS_USER']}:{env['VICTORIALOGS_PASSWORD']}".encode()
        headers['Authorization'] = 'Basic ' + base64.b64encode(pair).decode()
    req = Request(f"{env['VICTORIALOGS_URL'].rstrip('/')}{path}?{urlencode(params)}", headers=headers)
    try:
        with urlopen(req, timeout=60, context=deckenv.ssl_context()) as response:
            return response.read().decode(errors='replace')
    except HTTPError as error:
        raise SystemExit(f'VictoriaLogs answered HTTP {error.code}: {error.read().decode(errors="replace")[:300]}')


def clean(text):
    for pattern, replacement in PRIVATE:
        text = pattern.sub(replacement, text)
    return text


def query(args):
    body = ask('/select/logsql/query', {'query': f'_time:{args.since} {args.logsql}', 'limit': args.limit})
    for line in body.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if args.raw:
            print(clean(json.dumps(row, ensure_ascii=False)))
            continue
        name = next((row[k] for k in NAME if row.get(k)), '?')
        print(f"{row.get('_time', '')[:23]} {name}: {clean(row.get('_msg', ''))}")


def containers(args):
    body = ask('/select/logsql/query', {'query': f'_time:{args.since} * | stats by (container_name) count() lines'})
    rows = [json.loads(line) for line in body.splitlines() if line.strip()]
    for row in sorted(rows, key=lambda r: -int(r.get('lines', 0))):
        print(f"{row.get('lines', 0):>8} {row.get('container_name') or '?'}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    q = sub.add_parser('query')
    q.add_argument('logsql')
    q.add_argument('--limit', type=int, default=200)
    q.add_argument('--raw', action='store_true')
    c = sub.add_parser('containers')
    for command in (q, c):
        command.add_argument('--since', default='1h', help='5m, 1h, 2d …')
    args = p.parse_args()
    (query if args.cmd == 'query' else containers)(args)


if __name__ == '__main__':
    main()
