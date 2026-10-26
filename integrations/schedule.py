"""Prompts that wait for their moment, and continuing by itself after a subscription limit.

A prompt is sent at a time, when the session is free, or when the limit that stopped the session resets.
Every prompt is removed from the file before it is typed: a crash in between loses it, never sends it twice.
"""
from contextlib import nullcontext
import json
from pathlib import Path
import secrets
import threading
import time

from .private_files import write_private
from .limits import detect

TRIGGERS = ("time", "idle", "limit")
MAX_TEXT, MAX_PER_SESSION, MAX_AHEAD = 20000, 20, 30 * 86400
IDLE = 8            # Seconds without screen activity before a session counts as free.
AFTER_RESET = 60    # The limit lifts a little after the minute the agent names.
GONE_AFTER = 600    # A restart closes the session for a moment; a session gone this long is closed.
CONTINUE = "continue"


class Schedule:
    def __init__(self, directory, sessions, screen, blocked, send, window_reset=None, clock=time.time, input_lock=None):
        self.path = Path(directory) / "schedule.json"
        self.sessions, self.screen, self.blocked, self.send = sessions, screen, blocked, send
        self.window_reset = window_reset or (lambda agent: None)
        self.clock = clock
        self.input_lock = input_lock or (lambda name: nullcontext())
        self.waiting = set()  # After typing, every trigger waits for a new quiet period.
        self.lock = threading.RLock()
        self.activity = {}   # session -> [activity, changed_at]
        self.missing = {}    # session -> first time it was not found
        self.resumed = {}    # session -> the limit notice already acted on, kept in the file
        self.limits = {}     # session -> {'notice', 'at'} while a limit notice is on its screen
        self.errors = {}     # session -> why the last prompt was not sent
        self.started = False
        try:
            saved = json.loads(self.path.read_text())
        except (OSError, ValueError):
            saved = {}
        saved = saved if isinstance(saved, dict) else {}
        self.prompts = [p for p in saved.get("prompts", []) if self.valid(p)]
        self.auto = {name for name in saved.get("auto_resume", []) if isinstance(name, str)}
        resumed = saved.get("resumed", {})
        self.resumed = {k: v for k, v in (resumed if isinstance(resumed, dict) else {}).items() if isinstance(v, str)}

    @staticmethod
    def valid(prompt):
        return (isinstance(prompt, dict) and isinstance(prompt.get("id"), str) and isinstance(prompt.get("session"), str)
                and isinstance(prompt.get("text"), str) and prompt.get("trigger") in TRIGGERS
                and isinstance(prompt.get("at", 0), (int, float)))

    def save(self, prompts=None, auto=None, resumed=None):
        prompts = self.prompts if prompts is None else prompts
        auto = self.auto if auto is None else auto
        resumed = self.resumed if resumed is None else resumed
        write_private(self.path, json.dumps({"prompts": prompts, "auto_resume": sorted(auto),
                                             "resumed": resumed}, ensure_ascii=False).encode())
        self.prompts, self.auto, self.resumed = prompts, auto, resumed

    def status(self, name):
        with self.lock:
            return {"prompts": [{k: p[k] for k in ("id", "text", "trigger", "at", "created")}
                                for p in self.prompts if p["session"] == name],
                    "auto_resume": name in self.auto, "limit": self.limits.get(name), "error": self.errors.get(name, "")}

    def session(self, name):
        found = next((s for s in self.sessions() if s["name"] == name), None) if isinstance(name, str) else None
        if not found:
            raise ValueError("нет такой сессии")
        return found

    def add(self, name, text, trigger, at=None):
        session = self.session(name)
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            raise ValueError("Введите сообщение (до 20000 символов)")
        if trigger not in TRIGGERS:
            raise ValueError("Выберите, когда отправить сообщение")
        if trigger == "limit" and session.get("agent") == "shell":
            raise ValueError("У терминала нет лимитов подписки")
        now = self.clock()
        if trigger == "time":
            if isinstance(at, bool) or not isinstance(at, (int, float)) or not now - 60 <= at <= now + MAX_AHEAD:
                raise ValueError("Укажите время в ближайшие 30 дней")
        with self.lock:
            if sum(p["session"] == name for p in self.prompts) >= MAX_PER_SESSION:
                raise ValueError("Слишком много отложенных сообщений в этой сессии; удалите лишние")
            prompt = {"id": secrets.token_hex(8), "session": name, "text": text, "trigger": trigger,
                      "at": int(at) if trigger == "time" else 0, "created": int(now)}
            self.save(prompts=[*self.prompts, prompt])
            self.errors.pop(name, None)
        self.start()
        return self.status(name)

    def remove(self, identity):
        with self.lock:
            kept = [p for p in self.prompts if p["id"] != identity]
            if len(kept) != len(self.prompts):
                self.save(prompts=kept)

    def set_auto(self, name, enabled):
        session = self.session(name)
        if not isinstance(enabled, bool):
            raise ValueError("Автопродолжение можно только включить или выключить")
        if enabled and session.get("agent") == "shell":
            raise ValueError("У терминала нет лимитов подписки")
        with self.lock:
            self.save(auto=self.auto | {name} if enabled else self.auto - {name})
        self.start()
        return self.status(name)

    def forget(self, name):
        with self.lock:
            kept = [p for p in self.prompts if p["session"] != name]
            changed = len(kept) != len(self.prompts) or name in self.auto or name in self.resumed
            if changed:
                self.save(prompts=kept, auto=self.auto - {name},
                          resumed={k: v for k, v in self.resumed.items() if k != name})
            for memory in (self.activity, self.missing, self.limits, self.errors):
                memory.pop(name, None)
            self.waiting.discard(name)

    def idle(self, session, now):
        state = self.activity.get(session["name"])
        if state is None or state[0] != session.get("activity"):
            self.activity[session["name"]] = [session.get("activity"), now]
            return False
        return now - state[1] >= IDLE

    def limit(self, session, now):
        """The limit notice on an idle screen, with the reset time from the screen or the provider's counters."""
        name = session["name"]
        found = detect(self.screen(name), now)
        with self.lock:
            known = self.limits.get(name)
        if found and found["at"] is None:
            # Once the window resets the counters no longer name it, so the time learned earlier is kept.
            found["at"] = (self.window_reset(session.get("agent"))
                           or (known["at"] if known and known["notice"] == found["notice"] else None))
        with self.lock:
            if found:
                self.limits[name] = found
            else:
                self.limits.pop(name, None)
                # The notice left the screen: the next one, even with the same words, is a new limit.
                if name in self.resumed:
                    self.save(resumed={k: v for k, v in self.resumed.items() if k != name})
        return found

    def due(self, session, now):
        """Claim at most one prompt; only a durable removal permits terminal input."""
        name, free = session["name"], self.idle(session, now)
        if name in self.waiting and not free:
            return []
        if free:
            self.waiting.discard(name)
        with self.lock:
            mine = [p for p in self.prompts if p["session"] == name]
            waits_for_limit = name in self.auto or any(p["trigger"] == "limit" for p in mine)
        lifted = None
        if free and waits_for_limit and session.get("running"):
            found = self.limit(session, now)
            # A notice without a date reads as today's hour again tomorrow: it is acted on once, by its text.
            if found and found["at"] and now >= found["at"] + AFTER_RESET:
                if self.resumed.get(name) != found["notice"] or any(p["trigger"] == "limit" for p in mine):
                    lifted = found["notice"]
        chosen = [p for p in mine if p["trigger"] == "time" and now >= p["at"]]
        if lifted:
            chosen += [p for p in mine if p["trigger"] == "limit"]
        if free and not chosen:
            chosen = [p for p in mine if p["trigger"] == "idle"][:1]  # One at a time: the next waits for this one.
        chosen = min(chosen, key=lambda p: p["created"]) if chosen else None
        if chosen is None and not lifted:
            return []
        if not session.get("running") or self.blocked(name):
            return []  # A question would take the prompt as its answer; wait for the user.
        with self.lock:
            if chosen and not any(p["id"] == chosen["id"] for p in self.prompts):
                return []  # Cancellation may have won while the question or limit was checked.
            if chosen is None and name not in self.auto:
                return []
            resumed = dict(self.resumed)
            if lifted and (chosen is None or chosen["trigger"] == "limit"):
                resumed[name] = lifted
            kept = [p for p in self.prompts if chosen is None or p["id"] != chosen["id"]]
            self.save(prompts=kept, resumed=resumed)
        return [chosen["text"] if chosen else CONTINUE]

    def tick(self, now=None):
        now = self.clock() if now is None else now
        with self.lock:
            wanted = {p["session"] for p in self.prompts} | self.auto
        if not wanted:
            return
        sessions = {s["name"]: s for s in self.sessions()}
        for name in wanted:
            session = sessions.get(name)
            if session is None:
                with self.lock:
                    if now - self.missing.setdefault(name, now) >= GONE_AFTER:
                        self.forget(name)
                continue
            with self.input_lock(name), self.lock:
                self.missing.pop(name, None)
                for text in self.due(session, now):
                    # Even a partial failed input must get a quiet period before another prompt.
                    self.activity[name] = [session.get("activity"), now]
                    self.waiting.add(name)
                    try:
                        self.send(name, text)
                        self.errors.pop(name, None)
                    except Exception as error:  # Never retried: part of the text may already be typed.
                        self.errors[name] = str(error) if isinstance(error, ValueError) else type(error).__name__

    def start(self):
        with self.lock:
            if self.started:
                return
            self.started = True
        threading.Thread(target=self.loop, name="agent-deck-schedule", daemon=True).start()

    def loop(self):
        while True:
            time.sleep(5)
            try:
                self.tick()
            except Exception as error:  # A failed pass must not stop later prompts; it runs again in 5 s.
                print(f"Scheduled prompts check failed: {type(error).__name__}", flush=True)
