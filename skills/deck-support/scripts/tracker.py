#!/usr/bin/env python3
"""The project's task tracker, as its `.deckaway/project.json` names it (`tracker.kind`).

  tracker.py list [--all]
  tracker.py show N
  tracker.py find --source CHAT MSG
  tracker.py create "title" [--desc TEXT] [--source CHAT MSG [THREAD]]
  tracker.py source N CHAT MSG [THREAD]
  tracker.py comment N "text"
  tracker.py attach N FILE [FILE ...]
  tracker.py update N [--status S] [--assignee ID] [--index I] [--title T] [--desc D]
  tracker.py close N --result TEXT [--check-url URL] [--assignee ID]

Kinds: `dotasker` (built in: DOTASKER_URL and DOTASKER_AGENT_KEY from the project's .env, never printed),
`command` (each verb runs the profile's command with these arguments appended), `mcp` (says which tool to call).
"""
import argparse
import hashlib
import json
import mimetypes
from pathlib import Path
import shlex
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deckenv  # noqa: E402

STATUSES = ('waiting', 'inbox', 'in_progress', 'done')


class Dotasker:
    def __init__(self, config):
        names = (config.get('url', 'DOTASKER_URL'), config.get('key', 'DOTASKER_AGENT_KEY'))
        values = deckenv.secrets(names, [config.get('env', '.env')])
        self.base, self.key = values[names[0]].rstrip('/'), values[names[1]]

    def request(self, method, path, data=None, headers=None):
        headers = {'Authorization': f'Bearer {self.key}', **(headers or {})}
        if isinstance(data, dict):
            data = json.dumps(data).encode()
            headers['Content-Type'] = 'application/json'
        req = Request(f'{self.base}/api/v1/tasks/{path}', data=data, method=method, headers=headers)
        try:
            with urlopen(req, timeout=60, context=deckenv.ssl_context()) as response:
                return response.status, json.loads(response.read() or b'{}')
        except HTTPError as error:
            raise SystemExit(f'Dotasker answered HTTP {error.code}: {error.read().decode(errors="replace")[:500]}')

    def run(self, args):
        if args.cmd == 'list':
            return [short(t) for t in self.request('GET', '' if args.all else '?open=true')[1]['tasks']]
        if args.cmd == 'show':
            return self.request('GET', f'{args.n}/')[1]
        if args.cmd == 'find':
            chat, msg = args.source
            return [short(t) for t in self.request('GET', f'?chat_id={int(chat)}&message_id={int(msg)}')[1]['tasks']] or 'not found'
        if args.cmd == 'create':
            body = {'title': args.title, 'description': args.desc or ''}
            if args.source:
                body['source'] = source(args.source)
            status, task = self.request('POST', '', body)
            return f"{'created' if status == 201 else 'exists'} {short(task)}"
        if args.cmd == 'source':
            return self.request('POST', f'{args.n}/sources/', source(args.values))[1]
        if args.cmd == 'comment':
            return self.request('POST', f'{args.n}/comments/', {'text': args.text},
                                {'Idempotency-Key': once('comment', args.n, args.text)})[0]
        if args.cmd == 'attach':
            return [self.attach(args.n, Path(f)) for f in args.files]
        fields = {'status': 'done' if args.cmd == 'close' else args.status, 'result': getattr(args, 'result', None),
                  'check_url': getattr(args, 'check_url', None), 'title': getattr(args, 'title', None),
                  'description': getattr(args, 'desc', None), 'index': getattr(args, 'index', None),
                  'assignee_telegram_id': args.assignee}
        return short(self.request('PATCH', f'{args.n}/', {k: v for k, v in fields.items() if v is not None})[1])

    def attach(self, number, path):
        boundary, kind = uuid.uuid4().hex, mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
                f'Content-Type: {kind}\r\n\r\n').encode() + path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
        headers = {'Content-Type': f'multipart/form-data; boundary={boundary}',
                   'Idempotency-Key': once('attach', number, hashlib.sha256(body).hexdigest())}
        return f"{self.request('POST', f'{number}/attachments/', body, headers)[0]} {path.name}"


def once(*parts):
    """The same comment or file sent twice (a repeated tick) is kept once."""
    return hashlib.sha256('|'.join(map(str, parts)).encode()).hexdigest()[:40]


def source(values):
    chat, msg, thread = (int(v) for v in (list(values) + [0])[:3])
    middle = f'/{thread}' if thread else ''
    return {'chat_id': chat, 'message_id': msg, 'thread_id': thread or None,
            'url': f"https://t.me/c/{str(chat).removeprefix('-100')}{middle}/{msg}"}


def short(task):
    return f"#{task['number']} [{task['status']}] {task['title']}"


def by_command(config, argv):
    verb = argv[0]
    command = config.get('verbs', {}).get(verb)
    if not command:
        raise SystemExit(f'The profile maps no command to "{verb}" (tracker.verbs.{verb}).')
    return subprocess.run([*shlex.split(command), *argv[1:]], cwd=deckenv.root(), input='').returncode


def parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('list').add_argument('--all', action='store_true')
    sub.add_parser('show').add_argument('n', type=int)
    sub.add_parser('find').add_argument('--source', nargs=2, required=True, metavar=('CHAT', 'MSG'))
    create = sub.add_parser('create')
    create.add_argument('title')
    create.add_argument('--desc')
    create.add_argument('--source', nargs='+', metavar='CHAT MSG [THREAD]')
    src = sub.add_parser('source')
    src.add_argument('n', type=int)
    src.add_argument('values', nargs='+')
    comment = sub.add_parser('comment')
    comment.add_argument('n', type=int)
    comment.add_argument('text')
    att = sub.add_parser('attach')
    att.add_argument('n', type=int)
    att.add_argument('files', nargs='+')
    upd = sub.add_parser('update')
    upd.add_argument('n', type=int)
    upd.add_argument('--status', choices=STATUSES)
    upd.add_argument('--index', type=int, help='place in its column, 0 = top')
    for flag in ('--title', '--desc'):
        upd.add_argument(flag)
    close = sub.add_parser('close')
    close.add_argument('n', type=int)
    close.add_argument('--result', required=True)
    close.add_argument('--check-url')
    for command in (upd, close):
        command.add_argument('--assignee', type=int, help='Telegram id of who does the task')
    return p


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    config = deckenv.profile().get('tracker') or {'kind': 'dotasker'}
    if config.get('kind') == 'command' and argv:
        return by_command(config, argv)
    if config.get('kind') == 'mcp':
        tool = config.get('tools', {}).get(argv[0] if argv else '')
        raise SystemExit(f'This project\'s tracker is reached through MCP: call "{tool}".' if tool
                         else 'This project\'s tracker is reached through MCP; the profile names no tool for this.')
    out = Dotasker(config).run(parser().parse_args(argv))
    for line in out if isinstance(out, list) else [out]:
        print(json.dumps(line, ensure_ascii=False, indent=1) if isinstance(line, dict) else line)
    return 0


if __name__ == '__main__':
    sys.exit(main())
