import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

from integrations import skills, skill_bundle

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'skills' / 'deck-support' / 'scripts'


def script(name):
    spec = importlib.util.spec_from_file_location(f'deck_{name}', SCRIPTS / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.home = Path(self.dir.name)

    def tearDown(self):
        self.dir.cleanup()

    def test_skills_go_into_each_installed_agents_folder_once(self):
        (self.home / '.claude').mkdir()
        (self.home / '.codex').mkdir()
        done = skills.install(self.home, {})
        support = self.home / '.claude' / 'skills' / 'deck-support'
        self.assertEqual(done[str(support)], 'installed')
        self.assertTrue((self.home / '.codex' / 'skills' / 'deck-next-task' / 'SKILL.md').is_file())
        self.assertEqual((support / skills.MARKER).read_text().strip(), skill_bundle.VERSION)
        self.assertTrue(os.access(support / 'scripts' / 'tracker.py', os.X_OK))
        self.assertEqual(set(skills.install(self.home, {}).values()), {'current'})

    def test_no_agent_folder_means_nothing_written(self):
        self.assertEqual(skills.install(self.home, {}), {})
        self.assertFalse((self.home / '.claude').exists())

    def test_the_owners_own_folder_of_that_name_is_never_touched(self):
        own = self.home / '.claude' / 'skills' / 'deck-support'
        own.mkdir(parents=True)
        (own / 'SKILL.md').write_text('mine')
        self.assertEqual(skills.install(self.home, {})[str(own)], 'foreign')
        self.assertEqual((own / 'SKILL.md').read_text(), 'mine')

    def test_a_new_version_replaces_ours_and_a_dropped_skill_is_removed(self):
        root = self.home / '.claude' / 'skills'
        for name in ('deck-support', 'deck-gone'):
            (root / name).mkdir(parents=True)
            (root / name / skills.MARKER).write_text('old\n')
            (root / name / 'stale.md').write_text('x')
        (root / 'deck-mine').mkdir()  # Not ours: stays.
        done = skills.install(self.home, {})
        self.assertEqual(done[str(root / 'deck-support')], 'installed')
        self.assertFalse((root / 'deck-support' / 'stale.md').exists())
        self.assertEqual(done[str(root / 'deck-gone')], 'removed')
        self.assertTrue((root / 'deck-mine').is_dir())
        self.assertEqual([p.name for p in root.iterdir() if p.name.startswith('.')], [])

    def test_codex_home_is_honoured_and_the_note_names_the_skills(self):
        codex = self.home / 'cx'
        codex.mkdir()
        skills.install(self.home, {'CODEX_HOME': str(codex)})
        self.assertTrue((codex / 'skills' / 'deck-server' / 'SKILL.md').is_file())
        note = skills.agent_note('codex')
        self.assertIn('$CODEX_HOME/skills', note)
        for name in skills.NAMES:
            self.assertIn(name, note)
            self.assertIn(f'{name}/SKILL.md', skill_bundle.FILES)


class FakeDotasker(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):
        pass

    def answer(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.calls.append(('GET', self.path, self.headers['Authorization'], None))
        self.answer(200, {'tasks': [{'number': 7, 'status': 'inbox', 'title': 'Fix the form'}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.calls.append(('POST', self.path, self.headers['Authorization'], body))
        self.answer(201, {'number': 8, 'status': 'inbox', 'title': body.get('title', '')})

    do_PATCH = do_POST


class TrackerTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), FakeDotasker)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        (self.repo / '.env').write_text(f'DOTASKER_URL=http://127.0.0.1:{self.server.server_port}\n'
                                        'DOTASKER_AGENT_KEY=k-secret\n')
        FakeDotasker.calls = []
        self.tracker = script('tracker')
        self.root = mock.patch.object(self.tracker.deckenv, 'root', return_value=self.repo)
        self.root.start()

    def tearDown(self):
        self.root.stop()
        self.server.shutdown()
        self.server.server_close()
        self.dir.cleanup()

    def run_tracker(self, *argv):
        out = io.StringIO()
        with redirect_stdout(out), mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('DOTASKER_URL', None)
            os.environ.pop('DOTASKER_AGENT_KEY', None)
            self.assertEqual(self.tracker.main(list(argv)), 0)
        return out.getvalue()

    def test_dotasker_by_default_with_the_key_from_the_projects_env(self):
        self.assertIn('#7 [inbox] Fix the form', self.run_tracker('list'))
        self.assertIn('created #8', self.run_tracker('create', 'Title', '--source', '-1004429079537', '55', '21'))
        self.run_tracker('close', '8', '--result', 'Done', '--check-url', 'https://x.test/a')
        method, path, auth, body = FakeDotasker.calls[1]
        self.assertEqual(auth, 'Bearer k-secret')
        self.assertEqual(body['source'], {'chat_id': -1004429079537, 'message_id': 55, 'thread_id': 21,
                                          'url': 'https://t.me/c/4429079537/21/55'})
        self.assertEqual(FakeDotasker.calls[2][3], {'status': 'done', 'result': 'Done', 'check_url': 'https://x.test/a'})
        self.assertEqual(FakeDotasker.calls[0][1], '/api/v1/tasks/?open=true')

    def test_a_missing_key_names_the_key_and_the_file_never_a_value(self):
        (self.repo / '.env').write_text('DOTASKER_URL=http://x\n')
        with self.assertRaises(SystemExit) as caught:
            self.run_tracker('list')
        self.assertIn('DOTASKER_AGENT_KEY', str(caught.exception))
        self.assertNotIn('http://x', str(caught.exception))

    def test_a_command_tracker_runs_the_profiles_command_and_mcp_names_the_tool(self):
        (self.repo / '.deckaway').mkdir()
        profile = self.repo / '.deckaway' / 'project.json'
        profile.write_text(json.dumps({'tracker': {'kind': 'command', 'verbs': {'list': 'true'}}}))
        self.assertEqual(self.tracker.main(['list']), 0)
        with self.assertRaises(SystemExit):
            self.tracker.main(['show', '1'])  # No command for it.
        profile.write_text(json.dumps({'tracker': {'kind': 'mcp', 'tools': {'list': 'yougile_tasks'}}}))
        with self.assertRaises(SystemExit) as caught:
            self.tracker.main(['list'])
        self.assertIn('yougile_tasks', str(caught.exception))


class LogsTests(unittest.TestCase):
    def test_private_data_is_masked_before_printing(self):
        logs = script('logs')
        line = logs.clean('user a.b@mail.ru +7 (916) 123-45-67 token=abc Bearer xyz ok')
        for secret in ('a.b@mail.ru', '123-45-67', 'abc', 'xyz'):
            self.assertNotIn(secret, line)
        self.assertIn('ok', line)


if __name__ == '__main__':
    unittest.main()
