"""Agents that stand idle are put to sleep, and those at work are restarted once a day on the installed version.

Every agent keeps running the version it started with, and one left for days keeps its memory for nothing.
A session without screen activity for `sleep_days` (network.json, 0 = never) has its agent stopped: the
session stays, marked with when it fell asleep (@cc_slept), and one tap continues the same conversation.
An agent started more than a day ago is restarted with its conversation after three hours without activity.
Neither ever happens to a session with an open question, a prompt or a limit it waits for, or text typed
into its input box.
"""
import re
import threading
import time

SLEEP_DAYS = 3          # The default; the owner may change it or turn it off.
RESTART_AGE = 20 * 3600  # "Once a day", with room for when the quiet hour falls.
QUIET = 3 * 3600        # Screen untouched this long before a restart: a /loop wakes at least hourly, and
                        # a restart would end it (its timers live in the agent's process).
CHECK_EVERY = 600
PROMPT = re.compile(r'^(?:\x1b\[[0-9;]*m)*[❯›][  ](.{0,600})$')


def typed(ansi):
    """True when the input box at the bottom of a screen captured with its colours holds text the owner typed.
    A suggestion or hint there is dim, and the cursor draws one letter inverted; anything else is typed."""
    for line in reversed(ansi.split('\n')[-30:]):
        match = PROMPT.match(line)
        if not match:
            continue
        dim = inverse = False
        for part in re.split(r'(\x1b\[[0-9;]*m)', match[1]):
            codes = re.fullmatch(r'\x1b\[([0-9;]*)m', part)
            if codes:
                for code in (codes[1] or '0').split(';'):
                    code = int(code or 0)
                    dim = {0: False, 2: True, 22: False}.get(code, dim)
                    inverse = {0: False, 7: True, 27: False}.get(code, inverse)
            elif part.strip() and not dim and not inverse:
                return True
        return False
    return False


class Upkeep:
    def __init__(self, sessions, settings, age, screen, waiting, resumable, restart, sleep, clock=time.time):
        """sessions() as list_sessions gives them; age(name): seconds the agent has run, or None; screen(name):
        the bottom of its screen with colours; waiting(name): a question, prompt or limit holds it;
        resumable(session): it can continue its conversation; restart(name) and sleep(name) act."""
        self.sessions, self.settings, self.age, self.screen = sessions, settings, age, screen
        self.waiting, self.resumable, self.restart, self.sleep = waiting, resumable, restart, sleep
        self.clock = clock
        self.lock = threading.Lock()
        self.started = False

    def days(self):
        value = self.settings().get('sleep_days', SLEEP_DAYS)
        return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else SLEEP_DAYS

    def plan(self, now=None):
        """[(action, name)]: what is due now. Reads the screen and the process only of sessions that qualify."""
        now = self.clock() if now is None else now
        days, daily = self.days(), self.settings().get('daily_restart') is not False
        due = []
        for s in self.sessions():
            if s.get('agent') == 'shell' or not s.get('running') or s.get('runtime') == 'windows':
                continue
            quiet = now - (s.get('activity') or 0)
            if days and quiet >= days * 86400:
                action = 'sleep'
            elif daily and quiet >= QUIET and (self.age(s['name']) or 0) >= RESTART_AGE:
                action = 'restart'
            else:
                continue
            if self.resumable(s) and not self.waiting(s['name']) and not typed(self.screen(s['name'])):
                due.append((action, s['name']))
        return due

    def tick(self, now=None):
        for action, name in self.plan(now):
            try:
                (self.sleep if action == 'sleep' else self.restart)(name)
                print(f"upkeep: {action} {name}", flush=True)
            except Exception as error:  # One session failing must not keep the others on an old version.
                print(f"upkeep: {action} failed: {type(error).__name__}", flush=True)

    def start(self):
        with self.lock:
            if self.started:
                return
            self.started = True
        threading.Thread(target=self.loop, name='agent-deck-upkeep', daemon=True).start()

    def loop(self):
        while True:
            time.sleep(CHECK_EVERY)
            try:
                self.tick()
            except Exception as error:
                print(f"upkeep: check failed: {type(error).__name__}", flush=True)
