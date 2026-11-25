"""Decisions an agent needs from its owner, kept until they are answered.

An agent files one from its session's pane with this file as a command (`ask`, JSON on stdin) instead of asking in
the chat, where the question scrolls away between duty runs. The owner answers in the panel's sidebar; the answer
is typed into the session as a prompt and also shown to the agent by `list` and a repeated `ask`, until the agent
marks it `done`. A decision belongs to one session: its name and creation time, so a new session with the same name
never gets another one's answers.
"""
import json
import os
import re
import secrets
import shlex
import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path

PATH = '~/.config/cc-panel/decisions.sqlite3'
PREFIX = 'cc-'
KEY = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')
QUESTION, CONTEXT, OPTION, OPTIONS, ANSWER = 600, 6000, 200, 8, 8000
OPEN_PER_SESSION = 60
PROMPT_LIMIT = 19000
KEEP_CLOSED = 30 * 86400
SENT_SHOWN = 3 * 86400

NOTE = """Owner's decisions: during duty, loop or scheduled runs, and whenever you can go on without the answer, do not ask the owner in the chat or with a question tool (it scrolls away or stops the run): file the decision, finish what you can, and the owner answers from any device.
{cmd} ask <<'EOF'
{{"key": "short-stable-id", "question": "...", "context": "what you found, what each choice means, what you recommend", "options": ["...", "..."]}}
EOF
- The same key is the same decision: filing it again updates it and, once answered, prints the answer. Options are optional; the owner may answer in their own words.
- At the start of every run: `{cmd} list` shows what still waits and the answers that came; act on an answer, then `{cmd} done <key>`. `done` also withdraws a decision that no longer matters.
- Answers also arrive in this chat as a message starting with "Owner's decisions". Say briefly in the chat what you filed; do not repeat the question there.
- Ask in the chat only when the owner is talking to you right now and nothing can move until they answer."""


def command():
    return shlex.join([sys.executable, os.path.abspath(__file__)])


def agent_note():
    return NOTE.format(cmd=command())


def text(value, limit, name):
    if not isinstance(value, str) or len(value.strip()) > limit:
        raise ValueError(f'{name}: text up to {limit} characters')
    return value.strip()


class Decisions:
    def __init__(self, path=PATH, clock=time.time):
        self.path, self.clock = Path(os.path.expanduser(path)), clock
        # The panel and Telegram may send the same answer at once: one of them finds it already sent.
        self.sending = threading.Lock()
        self.path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        if self.path.is_symlink():
            raise ValueError('The decisions database must not be a symlink')
        os.close(os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600))
        self.path.chmod(0o600)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS decisions (
                    id TEXT PRIMARY KEY, session TEXT NOT NULL, created INTEGER NOT NULL, folder TEXT NOT NULL,
                    key TEXT NOT NULL, question TEXT NOT NULL, context TEXT NOT NULL, options TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('open', 'sent', 'done', 'dismissed')),
                    answer TEXT NOT NULL DEFAULT '', asked REAL NOT NULL, updated REAL NOT NULL, sent REAL);
                CREATE UNIQUE INDEX IF NOT EXISTS decisions_key ON decisions(session, created, key)
                    WHERE status != 'done';
                CREATE INDEX IF NOT EXISTS decisions_status ON decisions(status, session);''')
            db.execute("DELETE FROM decisions WHERE status IN ('done', 'dismissed') AND updated < ?",
                       (self.clock() - KEEP_CLOSED,))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def row(row):
        item = dict(row)
        item['options'] = json.loads(item['options'])
        return item

    # The agent's side, from its pane.
    def ask(self, session, created, folder, data):
        if not isinstance(data, dict):
            raise ValueError('expected a JSON object: {"key", "question", "context", "options"}')
        key = data.get('key')
        if not isinstance(key, str) or not KEY.match(key):
            raise ValueError('key: letters, digits, ".", "_" or "-", up to 80')
        question = text(data.get('question'), QUESTION, 'question')
        if not question:
            raise ValueError('question: required')
        context = text(data.get('context', ''), CONTEXT, 'context')
        options = data.get('options', [])
        if not isinstance(options, list) or len(options) > OPTIONS:
            raise ValueError(f'options: a list of up to {OPTIONS}')
        options = [text(option, OPTION, 'option') for option in options]
        options = json.dumps([option for option in options if option], ensure_ascii=False)
        now = self.clock()
        with self.connect() as db:
            found = db.execute("SELECT * FROM decisions WHERE session=? AND created=? AND key=? AND status!='done'",
                               (session, created, key)).fetchone()
            if found and found['status'] != 'open':
                return self.row(found)
            if found:
                db.execute('UPDATE decisions SET question=?, context=?, options=?, folder=?, updated=? WHERE id=?',
                           (question, context, options, folder, now, found['id']))
                return self.row(db.execute('SELECT * FROM decisions WHERE id=?', (found['id'],)).fetchone())
            waiting = db.execute("SELECT COUNT(*) FROM decisions WHERE session=? AND created=? AND status='open'",
                                 (session, created)).fetchone()[0]
            if waiting >= OPEN_PER_SESSION:
                raise ValueError(f'{waiting} decisions already wait for the owner; withdraw some with done')
            identity = secrets.token_hex(8)
            db.execute("INSERT INTO decisions VALUES (?,?,?,?,?,?,?,?,'open','',?,?,NULL)",
                       (identity, session, created, folder, key, question, context, options, now, now))
            return self.row(db.execute('SELECT * FROM decisions WHERE id=?', (identity,)).fetchone())

    def pending(self, session, created):
        """What the agent still has to see: waiting ones (the owner's draft is not an answer yet) and answers."""
        with self.connect() as db:
            rows = db.execute("SELECT * FROM decisions WHERE session=? AND created=? AND status!='done' ORDER BY asked",
                              (session, created)).fetchall()
        return [self.row(row) for row in rows]

    def done(self, session, created, key):
        with self.connect() as db:
            changed = db.execute("UPDATE decisions SET status='done', updated=? WHERE session=? AND created=? AND key=? "
                                 "AND status!='done'", (self.clock(), session, created, key)).rowcount
        if not changed:
            raise ValueError(f'no decision "{key}" in this session')

    # The owner's side, in the panel.
    def items(self, session=None):
        """Waiting and answered decisions (answers for a few days, until the agent marks them done)."""
        query = "SELECT * FROM decisions WHERE (status='open' OR (status='sent' AND sent>?))"
        args = [self.clock() - SENT_SHOWN]
        if session is not None:
            query, args = query + ' AND session=?', [*args, session]
        with self.connect() as db:
            rows = db.execute(query + ' ORDER BY asked', args).fetchall()
        return [self.row(row) for row in rows]

    def counts(self):
        """Waiting decisions per (session, created)."""
        with self.connect() as db:
            rows = db.execute("SELECT session, created, COUNT(*) FROM decisions WHERE status='open' "
                              "GROUP BY session, created").fetchall()
        return {(row[0], row[1]): row[2] for row in rows}

    def answer(self, identity, answer):
        if not isinstance(answer, str) or len(answer.strip()) > ANSWER:
            raise ValueError(f'Ответ длиннее {ANSWER} символов: сократите его')
        answer = answer.strip()
        with self.sending, self.connect() as db:  # Never between a send's reading and its marking.
            changed = db.execute("UPDATE decisions SET answer=?, updated=? WHERE id=? AND status='open'",
                                 (answer, self.clock(), identity)).rowcount
        if not changed:
            raise ValueError('Этот вопрос уже закрыт')

    def dismiss(self, identity):
        with self.sending, self.connect() as db:
            changed = db.execute("UPDATE decisions SET status='dismissed', updated=? WHERE id=? AND status='open'",
                                 (self.clock(), identity)).rowcount
        if not changed:
            raise ValueError('Этот вопрос уже закрыт')

    def send(self, ids, live, deliver):
        """Hands the answered ones among ids to their sessions, one prompt per session; live(session, created)
        says whether that very session still runs, deliver(session, prompt) queues the prompt."""
        with self.sending:
            return self.send_now(ids, live, deliver)

    def send_now(self, ids, live, deliver):
        if not isinstance(ids, list) or not ids or len(ids) > 200 or not all(isinstance(i, str) for i in ids):
            raise ValueError('неверный запрос')
        with self.connect() as db:
            marks = ','.join('?' * len(ids))
            rows = db.execute(f"SELECT * FROM decisions WHERE id IN ({marks}) AND status='open' AND answer!='' "
                              'ORDER BY asked', ids).fetchall()
        if not rows:
            raise ValueError('Нет ответов для отправки')
        groups = {}
        for row in rows:
            groups.setdefault((row['session'], row['created']), []).append(row)
        if not all(live(*group) for group in groups):
            raise ValueError('Сессия этого вопроса закрыта: ответ некуда отправить')
        prompts = {group: prompt(found) for group, found in groups.items()}
        if any(len(message) > PROMPT_LIMIT for message in prompts.values()):
            raise ValueError('Слишком длинные ответы: отправьте их по частям')
        sent = 0
        for (session, created), message in prompts.items():
            deliver(session, message)
            ids = [row['id'] for row in groups[(session, created)]]
            now = self.clock()
            with self.connect() as db:
                db.execute(f"UPDATE decisions SET status='sent', sent=?, updated=? WHERE id IN ({','.join('?' * len(ids))}) "
                           "AND status='open'", (now, now, *ids))
            sent += len(ids)
        return {'sent': sent}


def prompt(rows):
    parts = ["Owner's decisions (DeckAway), answers to what you filed:"]
    for row in rows:
        parts.append(f"\n[{row['key']}] {row['question'][:300]}\nAnswer: {row['answer']}")
    parts.append(f'\nAct on them, then mark each one handled: {command()} done <key>')
    return '\n'.join(parts)


def identity(environ=os.environ):
    """This pane's DeckAway session: (name, creation time, folder)."""
    socket, pane = environ.get('TMUX', '').split(',')[0], environ.get('TMUX_PANE', '')
    if not socket or not pane:
        raise ValueError('not inside a DeckAway session (no TMUX_PANE)')
    found = subprocess.run(['tmux', '-S', socket, 'display-message', '-p', '-t', pane,
                            '#{session_name}\t#{session_created}\t#{pane_current_path}'],
                           capture_output=True, text=True, timeout=5, input='').stdout.rstrip('\n').split('\t')
    if len(found) != 3 or not found[0].startswith(PREFIX) or not found[1].isdigit():
        raise ValueError('not inside a DeckAway session')
    return found[0][len(PREFIX):], int(found[1]), found[2]


def describe(item):
    if item['status'] == 'sent':
        return f"[{item['key']}] answered: {item['answer']}\n  (act on it, then: done {item['key']})"
    if item['status'] == 'dismissed':
        return f"[{item['key']}] the owner closed it without an answer: drop it (done {item['key']})"
    return f"[{item['key']}] waits for the owner: {item['question']}"


def main(argv, stdin=sys.stdin, environ=os.environ, service=None):
    try:
        session, created, folder = identity(environ)
        service = service or Decisions()
        if argv[:1] == ['ask'] and len(argv) == 1:
            item = service.ask(session, created, folder, json.loads(stdin.read() or 'null'))
            return print(describe(item) if item['status'] != 'open' else
                         f"Filed [{item['key']}]; the owner answers in DeckAway, the answer comes here as a message.") or 0
        if argv[:1] == ['list'] and len(argv) == 1:
            items = service.pending(session, created)
            return print('\n'.join(describe(item) for item in items) if items else 'Nothing waits.') or 0
        if argv[:1] == ['done'] and len(argv) == 2:
            service.done(session, created, argv[1])
            return print(f'[{argv[1]}] done.') or 0
        print('usage: decisions.py ask (JSON on stdin) | list | done <key>', file=sys.stderr)
        return 2
    except (ValueError, OSError, sqlite3.Error, subprocess.SubprocessError) as error:
        print(f'decisions: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
