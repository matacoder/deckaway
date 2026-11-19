import os
import signal
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from integrations import leftovers
from integrations.leftovers import Leftovers, find, seconds, tags_darwin, tags_linux

SOCKET = '/tmp/tmux-501/agent-deck'
PANES = {'%1': ('cc-api', 100), '%2': ('cc-web', 200)}


def proc(ppid, rss=1024, age=60, command='x'):
    return {'ppid': ppid, 'rss': rss, 'age': age, 'command': command}


class FindTests(unittest.TestCase):
    procs = {100: proc(1, command='claude'), 101: proc(100, command='pytest'),
             300: proc(1, rss=4096, command='emulator'), 301: proc(300, rss=2048, command='qemu'),
             400: proc(1, command='astro dev'), 500: proc(1, command='old'), 600: proc(1, command='not ours')}
    tags = {100: (f'{SOCKET},77,1', '%1'), 101: (f'{SOCKET},77,1', '%1'), 300: (f'{SOCKET},77,1', '%1'),
            301: (f'{SOCKET},77,1', '%1'), 400: (f'{SOCKET},77,3', '%9'), 500: (f'{SOCKET},12,1', '%1'),
            600: ('/tmp/tmux-501/default,5,0', '%1')}

    def test_detached_and_closed_sessions_processes_but_never_a_live_pane_or_another_server(self):
        groups = {g['pid']: g for g in find(self.procs, self.tags, PANES, SOCKET, '77')}
        # The live pane's agent and what it runs are the session itself; another tmux server is not ours.
        self.assertEqual(set(groups), {300, 400, 500})
        self.assertEqual((groups[300]['session'], groups[300]['rss'], groups[300]['count'], sorted(groups[300]['tree'])),
                         ('cc-api', 6144, 2, [300, 301]))
        self.assertEqual(groups[400]['session'], '')  # Its pane is gone.
        self.assertEqual(groups[500]['session'], '')  # Started under an earlier server: pane %1 is another one now.
        self.assertEqual(find(self.procs, self.tags, PANES, SOCKET, '77')[0]['pid'], 300)  # Largest first.
        self.assertNotIn(300, {g['pid'] for g in find(self.procs, self.tags, PANES, SOCKET, '77', exclude={300})})

    def test_ancestry_decides_where_macos_hides_the_environment_and_an_adopting_systemd_is_never_taken(self):
        # The pane's zsh and `sh -c` are macOS programs whose environment ps cannot read.
        procs = {10: proc(1, command='systemd --user'), 20: proc(10, command='tmux'), 100: proc(20, command='zsh'),
                 101: proc(100, command='claude'), 102: proc(101, command='bash run.sh'), 103: proc(102, command='codex exec'),
                 30: proc(10, command='panel.py'),
                 200: proc(10, command='sh -c run.sh'), 201: proc(200, command='codex exec'), 202: proc(201, command='pytest')}
        tag = (f'{SOCKET},20,1', '%1')
        tags = {101: tag, 103: tag, 201: tag, 202: tag}
        groups = find(procs, tags, {'%1': ('cc-api', 100)}, SOCKET, '20', exclude={30, 10})
        # The live agent and its own runs are the session; the run that lost its parent is what it left behind.
        self.assertEqual([(g['pid'], g['session'], sorted(g['tree'])) for g in groups], [(200, 'cc-api', [200, 201, 202])])
        # Without the pane, everything of it is a closed session's, and still nothing above it: never tmux.
        groups = find(procs, tags, {}, SOCKET, '20', exclude={30, 10})
        self.assertEqual(sorted((g['pid'], g['session']) for g in groups), [(100, ''), (200, '')])

    def test_elapsed_time_and_environment_parsing(self):
        self.assertEqual([seconds(t) for t in ('05', '01:05', '02:01:05', '3-02:01:05')], [5, 65, 7265, 266465])
        # The environment follows the arguments; an argument that looks like it does not count.
        output = (f' 42 node dev --x TMUX=/fake,1,1 TMUX={SOCKET},77,1 TMUX_PANE=%3 PATH=/bin\n'
                  ' 43 zsh PATH=/bin\nnot a line\n')
        self.assertEqual(tags_darwin(lambda command: output), {42: (f'{SOCKET},77,1', '%3')})
        with tempfile.TemporaryDirectory() as root:
            Path(root, '7').mkdir()
            Path(root, '7', 'environ').write_bytes(f'A=1\0TMUX={SOCKET},77,1\0TMUX_PANE=%4\0'.encode())
            self.assertEqual(tags_linux([7, 8], root), {7: (f'{SOCKET},77,1', '%4')})


class StopTests(unittest.TestCase):
    def setUp(self):
        self.killed = []
        self.service = Leftovers(lambda *a: '', kill=lambda pid, number: self.killed.append((pid, number)), sleep=lambda s: None)
        self.groups = [{'pid': 300, 'pane': '%1', 'session': 'cc-api', 'tree': {300: 600, 301: 30}, 'age': 600},
                       {'pid': 400, 'pane': '%9', 'session': '', 'tree': {400: 50}, 'age': 50}]
        patcher = patch.object(self.service, 'scan', return_value=self.groups)
        patcher.start()
        self.addCleanup(patcher.stop)
        thread = patch.object(leftovers.threading, 'Thread', side_effect=lambda target, args, daemon: type('T', (), {'start': lambda s: target(*args)})())
        thread.start()
        self.addCleanup(thread.stop)

    def test_only_listed_groups_are_stopped_and_survivors_are_killed_if_still_the_same(self):
        # 300 is still there and as old as before; 301 is a new process that took the pid.
        alive = {300: proc(1, age=605), 301: proc(1, age=1)}
        with patch.object(leftovers, 'processes', return_value=alive):
            self.assertEqual(self.service.stop([300, 999]), {'stopped': 1})
        self.assertEqual(self.killed, [(300, signal.SIGTERM), (301, signal.SIGTERM), (300, signal.SIGKILL)])
        for bad in ([], None, ['300'], [True], [999]):
            with self.subTest(pids=bad), self.assertRaises(ValueError):
                self.service.stop(bad)

    def test_closing_a_session_stops_only_what_its_panes_left(self):
        with patch.object(leftovers, 'processes', return_value={}):
            self.service.stop_panes({'%9', '%1'})
        # %1 belongs to a live session again, so only the closed pane's group goes.
        self.assertEqual(self.killed, [(400, signal.SIGTERM)])


class PanelTests(unittest.TestCase):
    def test_this_process_is_never_listed(self):
        service = Leftovers(lambda *a: f'%1\t100\tcc-api\t{SOCKET}\t77\n')
        me = os.getpid()
        procs = {me: proc(1), 100: proc(1)}
        with patch.object(leftovers, 'processes', return_value=procs), \
             patch.object(leftovers, 'tags_linux', return_value={me: (f'{SOCKET},77,1', '%5')}):
            self.assertEqual(service.scan(), [])
