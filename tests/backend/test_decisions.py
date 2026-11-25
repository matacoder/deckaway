import io
import json
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from integrations import decisions
from integrations.decisions import Decisions, main

ASK = {'key': 'db-index', 'question': 'Add the index now?', 'context': 'Queries take 4 s.', 'options': ['Yes', 'Later']}


class DecisionTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.now = [1000.0]
        self.service = Decisions(Path(self.dir.name, 'decisions.sqlite3'), clock=lambda: self.now[0])
        self.delivered = []

    def send(self, ids, live=lambda name, created: True):
        return self.service.send(ids, live, lambda name, text: self.delivered.append((name, text)))

    def test_the_same_key_is_one_decision_and_a_repeated_ask_after_the_answer_returns_it(self):
        first = self.service.ask('api', 10, '/p', ASK)
        again = self.service.ask('api', 10, '/p', {**ASK, 'question': 'Add the index today?'})
        self.assertEqual((again['id'], again['question'], again['options']), (first['id'], 'Add the index today?', ['Yes', 'Later']))
        # A new session with the same name is another session: its own decision, never the old one's answers.
        self.assertNotEqual(self.service.ask('api', 11, '/p', ASK)['id'], first['id'])
        self.service.answer(first['id'], 'Yes, tonight')
        self.assertEqual(self.service.pending('api', 10)[0]['status'], 'open')  # A draft is not an answer yet.
        self.assertEqual(self.send([first['id']]), {'sent': 1})
        self.assertEqual(self.delivered[0][0], 'api')
        self.assertIn('[db-index] Add the index today?\nAnswer: Yes, tonight', self.delivered[0][1])
        self.assertIn('decisions.py done <key>', self.delivered[0][1])
        answered = self.service.ask('api', 10, '/p', ASK)
        self.assertEqual((answered['status'], answered['answer']), ('sent', 'Yes, tonight'))
        self.service.done('api', 10, 'db-index')
        self.assertEqual(self.service.pending('api', 10), [])
        self.assertEqual(self.service.ask('api', 10, '/p', ASK)['status'], 'open')  # Done frees the key.
        with self.assertRaises(ValueError):
            self.service.done('api', 10, 'nothing')

    def test_the_owner_sees_waiting_ones_per_session_or_all_and_counts_per_session(self):
        a = self.service.ask('api', 10, '/p', ASK)
        self.service.ask('web', 20, '/w', {'key': 'k', 'question': 'Ship?'})
        self.assertEqual([i['session'] for i in self.service.items()], ['api', 'web'])
        self.assertEqual([i['session'] for i in self.service.items('web')], ['web'])
        self.assertEqual(self.service.counts(), {('api', 10): 1, ('web', 20): 1})
        self.service.dismiss(a['id'])
        self.assertEqual(self.service.counts(), {('web', 20): 1})
        self.assertEqual(self.service.ask('api', 10, '/p', ASK)['status'], 'dismissed')
        with self.assertRaises(ValueError):
            self.service.answer(a['id'], 'too late')

    def test_sending_needs_an_answer_and_the_very_session_and_groups_one_prompt_per_session(self):
        a = self.service.ask('api', 10, '/p', ASK)
        b = self.service.ask('api', 10, '/p', {'key': 'b', 'question': 'B?'})
        c = self.service.ask('web', 20, '/w', {'key': 'c', 'question': 'C?'})
        with self.assertRaises(ValueError):
            self.send([a['id']])  # No answer typed.
        for item in (a, b, c):
            self.service.answer(item['id'], 'ok')
        with self.assertRaises(ValueError):
            self.send([c['id']], live=lambda name, created: False)
        self.assertEqual(self.service.items('web')[0]['status'], 'open')  # Nothing sent, nothing lost.
        self.assertEqual(self.send([a['id'], b['id'], c['id']]), {'sent': 3})
        self.assertEqual(sorted(name for name, _ in self.delivered), ['api', 'web'])
        # Sent answers stay visible for a few days, then only the agent's list has them.
        self.assertEqual([i['status'] for i in self.service.items()], ['sent'] * 3)
        self.now[0] += decisions.SENT_SHOWN + 1
        self.assertEqual(self.service.items(), [])
        self.assertEqual(len(self.service.pending('api', 10)), 2)
        for bad in ([], None, [1], 'x'):
            with self.subTest(ids=bad), self.assertRaises(ValueError):
                self.send(bad)

    def test_two_sends_at_once_deliver_an_answer_once(self):
        import threading
        a = self.service.ask('api', 10, '/p', ASK)
        self.service.answer(a['id'], 'Yes')
        inside, results = threading.Event(), []

        def slow(name, text):
            inside.set()
            threading.Event().wait(0.2)  # The other caller arrives while this one is delivering.
            self.delivered.append((name, text))

        def panel():
            results.append(self.service.send([a['id']], lambda *_: True, slow))

        first = threading.Thread(target=panel)
        first.start()
        inside.wait(2)
        with self.assertRaises(ValueError):
            self.send([a['id']])  # Telegram's tap: already sent.
        first.join()
        self.assertEqual((results, len(self.delivered)), ([{'sent': 1}], 1))

    def test_input_is_checked_and_the_file_is_private(self):
        for bad in (None, {'key': 'a b', 'question': 'Q'}, {'key': 'k', 'question': ''}, {'key': 'k', 'question': 'x' * 601},
                    {'key': 'k', 'question': 'Q', 'options': 'Yes'}, {'key': 'k', 'question': 'Q', 'options': ['o'] * 9},
                    {'key': 'k', 'question': 'Q', 'options': [3]}):
            with self.subTest(data=bad), self.assertRaises(ValueError):
                self.service.ask('api', 10, '/p', bad)
        self.assertEqual(stat.S_IMODE(self.service.path.stat().st_mode), 0o600)
        with patch.object(decisions, 'OPEN_PER_SESSION', 1):
            self.service.ask('api', 10, '/p', ASK)
            with self.assertRaises(ValueError):
                self.service.ask('api', 10, '/p', {'key': 'more', 'question': 'Q'})


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.service = Decisions(Path(self.dir.name, 'd.sqlite3'))
        self.env = {'TMUX': '/tmp/tmux-1/agent-deck,77,1', 'TMUX_PANE': '%3'}

    def run_command(self, argv, stdin='', screen='cc-api\t10\t/p\n'):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(decisions.subprocess, 'run', return_value=SimpleNamespace(stdout=screen)) as run, \
                patch.object(decisions.sys, 'stdout', out), patch.object(decisions.sys, 'stderr', err):
            code = main(argv, io.StringIO(stdin), self.env, self.service)
        return code, out.getvalue() + err.getvalue(), run

    def test_the_pane_names_the_session_through_its_own_tmux_server(self):
        code, output, run = self.run_command(['ask'], json.dumps(ASK))
        self.assertEqual(code, 0)
        self.assertIn('Filed [db-index]', output)
        self.assertEqual(run.call_args.args[0][:5], ['tmux', '-S', '/tmp/tmux-1/agent-deck', 'display-message', '-p'])
        self.assertEqual(self.service.items('api')[0]['folder'], '/p')
        self.assertIn('waits for the owner: Add the index now?', self.run_command(['list'])[1])
        self.assertEqual(self.run_command(['done', 'db-index'])[0], 0)
        self.assertIn('Nothing waits.', self.run_command(['list'])[1])

    def test_outside_a_deckaway_session_or_with_bad_input_it_fails_clearly(self):
        self.assertEqual(self.run_command(['list'], screen='other\t10\t/p\n')[0], 1)
        self.env = {}
        self.assertEqual(self.run_command(['list'])[0], 1)
        self.env = {'TMUX': '/s,1,1', 'TMUX_PANE': '%1'}
        code, output, _ = self.run_command(['ask'], 'not json')
        self.assertEqual(code, 1)
        self.assertTrue(output.startswith('decisions: '))
        self.assertEqual(self.run_command(['nonsense'])[0], 2)

    def test_the_installed_hook_finds_the_notes_next_to_itself(self):
        # Installed, session_hook.py and integrations/ share one folder (/opt/cc-panel), unlike the source tree.
        import runpy
        import shutil
        import sys
        root = Path(__file__).resolve().parents[2]
        runtime = Path(self.dir.name, 'cc-panel')
        shutil.copytree(root / 'integrations', runtime / 'integrations', ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copy(root / 'panel/session_hook.py', runtime)
        saved = {name: module for name, module in sys.modules.items() if name == 'integrations' or name.startswith('integrations.')}
        path = sys.path[:]
        for name in saved:
            del sys.modules[name]
        sys.path[:] = [p for p in sys.path if not Path(p or '.').resolve() == root]
        try:
            hook = runpy.run_path(str(runtime / 'session_hook.py'))
            note = hook['decisions_note']()
        finally:
            sys.path[:] = path
            for name in [n for n in sys.modules if n == 'integrations' or n.startswith('integrations.')]:
                del sys.modules[name]
            sys.modules.update(saved)
        self.assertIn(str(runtime / 'integrations/decisions.py'), note)

    def test_the_agent_note_names_this_install(self):
        note = decisions.agent_note()
        self.assertIn(str(Path(decisions.__file__).resolve()), note)
        self.assertIn('done <key>', note)


if __name__ == '__main__':
    unittest.main()
