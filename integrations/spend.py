"""Tokens each session spent per day, from the agent's own conversation files.

Claude Code writes the usage of every answer into its JSONL file (one answer can fill several records with the
same message id: counted once), and the agents it starts into `<conversation>/subagents/*.jsonl`. Codex writes
a running total after every turn. A file is read once from the start, then only what was appended. A session
keeps every conversation it had since the panel started (a `/clear`, a restart), so its day adds them up.
Days are this computer's local dates. The current conversation's first timestamp is its age.
"""
from datetime import datetime
import json
import threading
import time

CHECK_EVERY = 60
PARTS = ('input', 'cache_write', 'cache_read', 'output')


def moment(stamp):
    try:
        return datetime.fromisoformat(str(stamp).replace('Z', '+00:00')).astimezone()
    except ValueError:
        return None


def day_of(stamp):
    when = moment(stamp)
    return when and when.date().isoformat()


class FileTally:
    """What one conversation file has spent per day, kept up to date by reading only what was appended."""

    def __init__(self, kind):
        self.kind, self.offset, self.identity = kind, 0, None
        self.days, self.seen, self.total = {}, set(), 0
        self.started = None  # The conversation's first timestamp: a restart that continues it keeps it.

    def update(self, path):
        stat = path.stat()
        if self.identity != stat.st_ino or stat.st_size < self.offset:
            self.__init__(self.kind)  # Replaced or cut: counted again from the start.
            self.identity = stat.st_ino
        if stat.st_size == self.offset:
            return
        with path.open('rb') as stream:
            stream.seek(self.offset)
            for line in stream:
                if not line.endswith(b'\n'):
                    break  # Still being written: read on the next pass.
                self.offset += len(line)
                try:
                    record = json.loads(line)
                except (ValueError, UnicodeError):
                    continue
                if isinstance(record, dict):
                    self.add(record)

    def add(self, record):
        if self.started is None and (when := moment(record.get('timestamp') or '')):
            self.started = int(when.timestamp())
        parts = self.codex(record) if self.kind == 'codex' else self.claude(record)
        day = parts and day_of(record.get('timestamp'))
        if day:
            kept = self.days.setdefault(day, [0, 0, 0, 0])
            for index, value in enumerate(parts):
                kept[index] += value

    def claude(self, record):
        message = record.get('message')
        usage = message.get('usage') if isinstance(message, dict) else None
        if record.get('type') != 'assistant' or not isinstance(usage, dict) or message.get('model') == '<synthetic>':
            return None
        key = message.get('id') or record.get('requestId') or record.get('uuid')
        if key in self.seen:
            return None
        self.seen.add(key)
        return [int(usage.get(name) or 0) for name in
                ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')]

    def codex(self, record):
        payload = record.get('payload')
        info = payload.get('info') if isinstance(payload, dict) and payload.get('type') == 'token_count' else None
        usage = info.get('total_token_usage') if isinstance(info, dict) else None
        if not isinstance(usage, dict):
            return None
        total = int(usage.get('total_tokens') or 0)
        if total <= self.total:
            return None  # The same total repeated (a rate-limit update), or a restarted count.
        last = info.get('last_token_usage') if isinstance(info.get('last_token_usage'), dict) else usage
        self.total = total
        cached = int(last.get('cached_input_tokens') or 0)
        return [max(int(last.get('input_tokens') or 0) - cached, 0), int(last.get('cache_write_input_tokens') or 0),
                cached, int(last.get('output_tokens') or 0)]


class Spend:
    def __init__(self, sessions, transcript, clock=time.time):
        """sessions(): as list_sessions gives them; transcript(agent, sid): the conversation file or None."""
        self.sessions, self.transcript, self.clock = sessions, transcript, clock
        self.lock = threading.Lock()
        self.tallies, self.files, self.shown = {}, {}, {}
        self.started = False

    def files_of(self, kind, path):
        if kind == 'codex':
            return [path]
        return [path, *sorted(path.with_suffix('').glob('subagents/*.jsonl'))]

    def check(self):
        shown, live = {}, set()
        for s in self.sessions():
            key = (s['name'], s.get('created'))
            live.add(key)
            path = s.get('sid') and self.transcript(s.get('agent'), s['sid'])
            if path:
                self.files.setdefault(key, set()).add(('codex' if s.get('agent') == 'codex' else 'claude', path))
            days = self.days_of(key)
            started = path and self.tallies.get(path) and self.tallies[path].started
            if days or started:
                shown[key] = (days, started)
        self.forget(live)
        with self.lock:
            self.shown = shown

    def days_of(self, key):
        days = {}
        for kind, main in self.files.get(key, ()):
            for file in self.files_of(kind, main):
                tally = self.tallies.setdefault(file, FileTally(kind))
                try:
                    tally.update(file)
                except OSError:
                    continue
                for day, parts in tally.days.items():
                    days[day] = [a + b for a, b in zip(days.get(day, [0, 0, 0, 0]), parts)]
        return days

    def forget(self, live):
        for key in [k for k in self.files if k not in live]:
            for kind, main in self.files.pop(key):
                for file in self.files_of(kind, main):
                    self.tallies.pop(file, None)

    def of(self, name, created):
        """{day, today: {input, cache_write, cache_read, output}, yesterday: total, started: when the current
        conversation began or None} or None."""
        with self.lock:
            days, started = self.shown.get((name, created), (None, None))
        if not days and not started:
            return None
        days = days or {}
        today = datetime.fromtimestamp(self.clock()).date()
        yesterday = datetime.fromtimestamp(self.clock() - 86400).date().isoformat()
        parts = days.get(today.isoformat(), [0, 0, 0, 0])
        return {'day': today.isoformat(), 'today': dict(zip(PARTS, parts)), 'yesterday': sum(days.get(yesterday, [])),
                'started': started}

    def start(self):
        with self.lock:
            if self.started:
                return
            self.started = True
        threading.Thread(target=self.loop, name='agent-deck-spend', daemon=True).start()

    def loop(self):
        while True:
            try:
                self.check()
            except Exception as error:  # A broken file must not stop the count for every session.
                print(f"spend: check failed: {type(error).__name__}", flush=True)
            time.sleep(CHECK_EVERY)
