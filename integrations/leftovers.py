"""Processes started from DeckAway's sessions that outlive them or run detached from them.

Everything started in a session's pane inherits TMUX ("socket,server pid,session") and TMUX_PANE from tmux, also
what an agent sends to the background, which keeps running after its parent exits (dev servers, emulators, test
runners). Those two variables tell such a process from any other of the same user, so only processes of this
panel's own tmux server are ever listed or stopped.
"""
import os
import re
import signal
import subprocess
import sys
import threading
import time

LINE = re.compile(r'^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s(.*)$')
TERM_WAIT = 5


def seconds(etime):
    """ps's elapsed time, [[dd-]hh:]mm:ss."""
    days, _, clock = etime.rpartition('-')
    parts = [int(part) for part in clock.split(':')]
    while len(parts) < 3:
        parts.insert(0, 0)
    return int(days or 0) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]


def processes(run):
    """This user's processes: pid -> ppid, resident KB, age in seconds, command line."""
    output = run(['ps', '-axww', '-o', 'pid=,ppid=,uid=,rss=,etime=,command='])
    uid, found = os.getuid(), {}
    for line in output.splitlines():
        match = LINE.match(line)
        if match and int(match[3]) == uid:
            found[int(match[1])] = {'ppid': int(match[2]), 'rss': int(match[4]), 'age': seconds(match[5]),
                                    'command': match[6].strip()}
    return found


def tags_darwin(run):
    """TMUX and TMUX_PANE per process; macOS gives another process's environment only through ps -E, after
    its arguments, so the last occurrence is the environment's."""
    tags = {}
    for line in run(['ps', '-axww', '-E', '-o', 'pid=,command=']).splitlines():
        pid, _, rest = line.strip().partition(' ')
        socket = re.findall(r' TMUX=(\S+)', rest)
        pane = re.findall(r' TMUX_PANE=(%\d+)', rest)
        if pid.isdigit() and socket and pane:
            tags[int(pid)] = (socket[-1], pane[-1])
    return tags


def tags_linux(pids, root='/proc'):
    tags = {}
    for pid in pids:
        try:
            with open(f'{root}/{pid}/environ', 'rb') as stream:
                variables = dict(item.split(b'=', 1) for item in stream.read().split(b'\0') if b'=' in item)
        except OSError:
            continue
        socket, pane = variables.get(b'TMUX'), variables.get(b'TMUX_PANE')
        if socket and pane:
            tags[pid] = (socket.decode('utf-8', 'replace'), pane.decode('utf-8', 'replace'))
    return tags


def find(procs, tags, panes, socket, server, exclude=()):
    """Roots of this server's processes that are not a live pane's own process, each with everything under it.
    panes: live pane id -> (session name, pane pid). A process of an earlier server of the same socket, or of
    a pane that is gone, belongs to a closed session."""
    ours = {}
    for pid, (value, pane) in tags.items():
        parts = value.split(',')
        if pid in procs and pid not in exclude and parts[0] == socket:
            live = len(parts) > 1 and parts[1] == str(server) and pane in panes
            ours[pid] = (pane, panes[pane][0] if live else '')
    children = {}
    for pid, info in procs.items():
        children.setdefault(info['ppid'], []).append(pid)
    groups = []
    for pid, (pane, session) in ours.items():
        if procs[pid]['ppid'] in ours or (session and panes[pane][1] == pid):
            continue
        tree, stack = [], [pid]
        while stack:
            current = stack.pop()
            tree.append(current)
            stack.extend(child for child in children.get(current, []) if child not in exclude)
        groups.append({'pid': pid, 'pane': pane, 'session': session, 'command': procs[pid]['command'][:400],
                       'age': procs[pid]['age'], 'rss': sum(procs[p]['rss'] for p in tree), 'count': len(tree),
                       'tree': {p: procs[p]['age'] for p in tree}})
    return sorted(groups, key=lambda group: -group['rss'])


class Leftovers:
    def __init__(self, tmux, platform=sys.platform, kill=os.kill, sleep=time.sleep):
        self.tmux, self.platform, self.kill, self.sleep = tmux, platform, kill, sleep
        self.lock = threading.Lock()

    def run(self, command):
        return subprocess.run(command, capture_output=True, text=True, timeout=20, input='').stdout

    def scan(self):
        panes, socket, server = {}, None, None
        for line in self.tmux('list-panes', '-a', '-F', '#{pane_id}\t#{pane_pid}\t#{session_name}\t#{socket_path}\t#{pid}').splitlines():
            parts = line.split('\t')
            if len(parts) == 5 and parts[1].isdigit():
                panes[parts[0]] = (parts[2], int(parts[1]))
                socket, server = parts[3], parts[4]
        if socket is None:
            return []
        procs = processes(self.run)
        tags = tags_darwin(self.run) if self.platform == 'darwin' else tags_linux(procs)
        # The panel itself never stops itself or what it runs, even when started from a session's shell.
        mine, pid = set(), os.getpid()
        while pid in procs and pid not in mine:
            mine.add(pid)
            pid = procs[pid]['ppid']
        return find(procs, tags, panes, socket, server, exclude=mine)

    def payload(self):
        return {'processes': [{**{key: group[key] for key in ('pid', 'session', 'command', 'age', 'rss', 'count')},
                               'closed': not group['session']} for group in self.scan()]}

    def stop(self, pids):
        """Stops the listed groups (by root pid, as listed now) with everything under them: TERM, then KILL."""
        if not isinstance(pids, list) or not pids or len(pids) > 200 or not all(isinstance(p, int) and not isinstance(p, bool) for p in pids):
            raise ValueError('неверный запрос')
        with self.lock:
            groups = [group for group in self.scan() if group['pid'] in set(pids)]
            if not groups:
                raise ValueError('Эти процессы уже завершились')
            self.signal(groups)
        return {'stopped': len(groups)}

    def stop_panes(self, panes):
        """What a closed session left running: everything that still names one of its panes."""
        with self.lock:
            groups = [group for group in self.scan() if not group['session'] and group['pane'] in panes]
            if groups:
                self.signal(groups)

    def signal(self, groups):
        targets = {pid: age for group in groups for pid, age in group['tree'].items()}
        for pid in targets:
            self.send(pid, signal.SIGTERM)
        threading.Thread(target=self.finish, args=(targets, time.monotonic()), daemon=True).start()

    def finish(self, targets, since):
        self.sleep(TERM_WAIT)
        # A pid can be taken again in the meantime: only a process at least as old as the one signalled is it.
        waited = time.monotonic() - since
        alive = processes(self.run)
        for pid, age in targets.items():
            if pid in alive and alive[pid]['age'] + 2 >= age + waited:
                self.send(pid, signal.SIGKILL)

    def send(self, pid, number):
        try:
            self.kill(pid, number)
        except (ProcessLookupError, PermissionError):
            pass
