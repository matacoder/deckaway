#!/usr/bin/env python3
"""Dokploy API with the agent's key, secrets masked in every answer.

  dokploy.py --env ~/.config/dokploy/<host>.env get <router.action> [key=value ...]
  dokploy.py --env ~/.config/dokploy/<host>.env post <router.action> <body.json|->
  dokploy.py --env … whoami

DOKPLOY_URL and DOKPLOY_TOKEN come from the env file (0600). Bodies come from a file or stdin, so secret values
never appear on a command line. Never print the key.
"""
import argparse
import json
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deck-support' / 'scripts'))
import deckenv  # noqa: E402


def call(env, method, action, query=None, body=None):
    url = f"{env['DOKPLOY_URL'].rstrip('/')}/api/{action}" + (f'?{urlencode(query)}' if query else '')
    headers = {'x-api-key': env['DOKPLOY_TOKEN']}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = Request(url, data=body, method=method, headers=headers)
    try:
        with urlopen(req, timeout=60, context=deckenv.ssl_context()) as response:
            raw = response.read().decode(errors='replace')
    except HTTPError as error:
        raise SystemExit(f'Dokploy answered HTTP {error.code} for {action}: {error.read().decode(errors="replace")[:300]}')
    try:
        return json.dumps(deckenv.mask(json.loads(raw)), ensure_ascii=False, indent=1)
    except ValueError:
        return raw[:2000]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--env', required=True, help='the server\'s env file')
    sub = p.add_subparsers(dest='cmd', required=True)
    get = sub.add_parser('get')
    get.add_argument('action')
    get.add_argument('params', nargs='*', help='key=value')
    post = sub.add_parser('post')
    post.add_argument('action')
    post.add_argument('body', help='a JSON file, or - for stdin')
    sub.add_parser('whoami')
    args = p.parse_args()
    env = deckenv.secrets(('DOKPLOY_URL', 'DOKPLOY_TOKEN'), [args.env])
    if args.cmd == 'whoami':
        print(call(env, 'GET', 'user.getPermissions'))
    elif args.cmd == 'get':
        print(call(env, 'GET', args.action, dict(kv.split('=', 1) for kv in args.params)))
    else:
        body = sys.stdin.buffer.read() if args.body == '-' else Path(args.body).read_bytes()
        json.loads(body)  # A broken body fails here, not on the server.
        print(call(env, 'POST', args.action, body=body))


if __name__ == '__main__':
    main()
