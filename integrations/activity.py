"""When a session last showed something new, without the redraw a resize causes.

tmux counts any output as activity, and an agent redraws its whole screen when its window changes size,
which happens whenever a terminal attaches somewhere (a phone, another tab, a page coming back). Pages
read activity as "working", so every attach looked like a short burst of work that had just finished.
A restart the panel makes by itself (integrations/upkeep.py) is held the same way.
"""
import threading

# A redraw follows the resize within moments, but a scan may land between the two.
REDRAW_GRACE = 3


class Activity:
    def __init__(self):
        self.lock = threading.Lock()
        self.seen = {}  # (name, created) -> {'size', 'shown', 'until'}

    def shown(self, key, size, activity, now):
        """The activity to report: tmux's own, unless it came from a resize seen at or just before this scan."""
        with self.lock:
            seen = self.seen.get(key)
            if seen is None:
                self.seen[key] = {'size': size, 'shown': activity, 'until': 0}
                return activity
            if size != seen['size']:
                seen.update(size=size, until=now + REDRAW_GRACE)
            elif activity > seen['shown'] and activity > seen['until']:
                seen['shown'] = activity
            return seen['shown']

    def hold(self, key, until):
        """Activity up to `until` is not shown: the redraw of an agent the panel itself restarts or stops."""
        with self.lock:
            if key in self.seen:
                self.seen[key]['until'] = max(self.seen[key]['until'], until)

    def forget(self, live):
        with self.lock:
            self.seen = {key: value for key, value in self.seen.items() if key in live}
