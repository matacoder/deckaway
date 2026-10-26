import base64
import calendar
import json
from pathlib import Path
import tempfile
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from integrations import windows
from integrations.windows import Windows, encoded, interop, script, to_linux, to_windows

from support import PanelCase

SID = '123e4567-e89b-42d3-a456-426614174000'


def decoded(command):
    return base64.b64decode(command.rsplit(' ', 1)[1]).decode('utf-16-le')


def probe(stdout='', code=0, stderr=''):
    return Mock(return_value=SimpleNamespace(returncode=code, stdout=stdout, stderr=stderr))


class WindowsTests(unittest.TestCase):
    def test_folders_are_translated_both_ways_and_odd_ones_refused(self):
        self.assertEqual(to_windows('/mnt/c/Users/me/win11'), 'C:\\Users\\me\\win11')
        self.assertEqual(to_windows('/mnt/d'), 'D:\\')
        self.assertIsNone(to_windows('/home/dev/win11'))
        self.assertEqual(to_linux('C:\\Users\\me\\win11'), '/mnt/c/Users/me/win11')
        self.assertEqual(to_linux(' c:/Users/me/ '), '/mnt/c/Users/me')
        for bad in ('Users\\me', 'C:\\Users\\..\\Windows', 'C:\\a\\.', 'C:\\a?b', '\\\\server\\share', 'C:\\a\nb', None):
            with self.assertRaises(ValueError, msg=bad):
                to_linux(bad)

    def test_the_agent_starts_in_the_folder_with_its_own_flags(self):
        new = script('claude', 'C:\\Users\\me\\it\'s', SID)
        self.assertIn("Set-Location -LiteralPath 'C:\\Users\\me\\it''s'", new)
        self.assertIn("$env:CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = '1'", new)
        self.assertTrue(new.endswith(f"& $agent '--session-id' '{SID}'"))
        self.assertIn('-CommandType Application', new)  # Never an npm .ps1 the execution policy refuses.
        self.assertIn("$_.Extension -in '.exe','.cmd','.bat'", new)  # Nor npm's extensionless script Windows cannot run.
        self.assertIn("$_.Extension -in '.exe','.cmd','.bat'", windows.PROBE)
        self.assertIn("GetEnvironmentVariable('Path','User')", new)
        self.assertIn("$PSHOME + ';' + [Environment]::SystemDirectory", new)  # Codex updates through powershell.exe.
        self.assertIn("$env:USERPROFILE + '\\.local\\bin'", new)  # Where Claude Code's installer puts claude.exe.
        self.assertTrue(script('claude', 'C:\\x', SID, resume=True, skip=True).endswith(
            f"& $agent '--resume' '{SID}' '--dangerously-skip-permissions'"))
        self.assertTrue(script('codex', 'C:\\x').endswith("& $agent '--no-daemon' '--no-alt-screen'"))
        self.assertTrue(script('codex', 'C:\\x', SID, resume=True).endswith(f"'--no-alt-screen' 'resume' '{SID}'"))
        self.assertNotIn('$agent', script('shell', 'C:\\x'))
        with self.assertRaisesRegex(ValueError, 'conversation is unknown'):
            script('codex', 'C:\\x', resume=True)
        with self.assertRaises(ValueError):
            script('kimi', 'C:\\x')
        with self.assertRaises(ValueError):
            script('claude', 'C:\\x', "x'; Remove-Item")

    def test_the_pane_line_carries_the_script_encoded_and_the_interop_socket(self):
        service = Windows(wsl=lambda: True, find=lambda: '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
        with patch.object(windows, 'interop', return_value={'WSL_INTEROP': '/run/WSL/12_interop'}):
            line = service.command('claude', '/mnt/c/Users/me/win11', SID)
        self.assertTrue(line.startswith('WSL_INTEROP=/run/WSL/12_interop /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoLogo -EncodedCommand '))
        self.assertIn("Set-Location -LiteralPath 'C:\\Users\\me\\win11'", decoded(line))
        with patch.object(windows, 'interop', return_value={}):
            self.assertIn(' -NoLogo -NoExit -EncodedCommand ', service.command('shell', '/mnt/c/Users/me'))
        with self.assertRaises(ValueError):
            service.command('claude', '/home/dev/win11', SID)
        with self.assertRaises(ValueError):
            Windows(wsl=lambda: False).command('claude', '/mnt/c/x', SID)

    def test_a_service_without_the_interop_variable_gets_the_newest_socket(self):
        self.assertEqual(interop({}, []), {})
        with patch.object(windows, 'socket_age', side_effect=lambda path: {'/run/WSL/1_interop': -1, '/run/WSL/9_interop': -5}[path]):
            self.assertEqual(interop({}, ['/run/WSL/1_interop', '/run/WSL/9_interop']), {'WSL_INTEROP': '/run/WSL/9_interop'})
        with patch.object(windows.os.path, 'exists', return_value=True):
            self.assertEqual(interop({'WSL_INTEROP': '/run/WSL/3_interop'}, ['/run/WSL/9_interop']), {})
        with patch.object(windows.os.path, 'exists', return_value=True), patch.object(windows, 'socket_age', return_value=0):
            self.assertEqual(windows.candidates({'WSL_INTEROP': '/run/WSL/3_interop'}, ['/run/WSL/9_interop', '/run/WSL/3_interop']),
                             ['/run/WSL/3_interop', '/run/WSL/9_interop'])

    def test_status_names_powershell_home_and_agents_and_is_kept_a_minute(self):
        run, now = probe('{"version":"5.1.22621.4391","home":"C:\\\\Users\\\\me","agents":["claude","notepad"]}\n'), [0]
        service = Windows(run=run, clock=lambda: now[0], wsl=lambda: True, find=lambda: 'powershell.exe')
        status = service.status()
        self.assertEqual(status, {'available': True, 'ready': True, 'version': '5.1.22621.4391', 'home': '/mnt/c/Users/me',
                                  'windows_home': 'C:\\Users\\me', 'admin': False, 'agents': ['claude']})
        self.assertEqual(run.call_args.kwargs['input'], '')
        self.assertIn('-EncodedCommand', run.call_args.args[0])
        now[0] = 30
        service.status()
        self.assertEqual(run.call_count, 1)
        self.assertEqual(service.home(), '/mnt/c/Users/me')
        now[0] = 61
        service.status()
        self.assertEqual(run.call_count, 2)

    def test_agents_start_through_the_elevated_wsl_when_one_runs(self):
        answers = {'/run/WSL/9_interop': 'false', '/run/WSL/2_interop': 'true'}

        def run(args, env, **kwargs):
            admin = answers[env['WSL_INTEROP']]
            return SimpleNamespace(returncode=0, stderr='', stdout='{"version":"5.1","home":"C:\\\\Users\\\\me","admin":' + admin + '}')
        service = Windows(run=run, wsl=lambda: True, find=lambda: 'powershell.exe')
        with patch.object(windows, 'candidates', return_value=list(answers)):
            self.assertTrue(service.status()['admin'])
        with patch.object(windows.os.path, 'exists', return_value=True):
            self.assertTrue(service.command('shell', '/mnt/c/Users/me').startswith('WSL_INTEROP=/run/WSL/2_interop '))
        answers['/run/WSL/2_interop'] = 'false'
        with patch.object(windows, 'candidates', return_value=list(answers)):
            self.assertFalse(service.status(again=True)['admin'])
        self.assertEqual(service.socket, '/run/WSL/9_interop')  # Unelevated, the newest is as good as any.

    def test_a_failure_is_named_without_its_text(self):
        def status(run):
            return Windows(run=run, wsl=lambda: True, find=lambda: 'powershell.exe').status()
        self.assertEqual(status(probe(code=1, stderr='<3>WSL (12) ERROR: UtilBindVsockAnyPort:307: socket failed 1'))['error'],
                         'WSL could not start Windows programs (WSL interop)')
        self.assertEqual(status(probe(code=5, stderr='secret path'))['error'], 'PowerShell exited with code 5')
        self.assertEqual(status(Mock(side_effect=subprocess.TimeoutExpired('powershell.exe', 30)))['error'],
                         'TimeoutExpired while starting PowerShell')
        self.assertEqual(Windows(wsl=lambda: False).status(), {'available': False})

    def test_a_new_folder_must_be_inside_the_windows_user_folder(self):
        service = Windows(wsl=lambda: True, find=lambda: 'powershell.exe', clock=lambda: 0)
        service.found = (0, {'available': True, 'ready': True, 'home': '/mnt/c/Users/me', 'windows_home': 'C:\\Users\\me'})
        with self.assertRaisesRegex(ValueError, 'C:\\\\Users\\\\me'):
            service.folder('C:\\Windows\\System32')
        with self.assertRaises(ValueError):
            service.folder('C:\\Users\\meme')
        with patch.object(windows.os, 'makedirs') as made, patch.object(windows.os.path, 'exists', return_value=False):
            self.assertEqual(service.folder('C:\\Users\\me\\win11'), '/mnt/c/Users/me/win11')
        made.assert_called_once_with('/mnt/c/Users/me/win11', exist_ok=True)
        service.found = (0, {'available': True, 'ready': False, 'error': 'WSL could not start Windows programs (WSL interop)'})
        with self.assertRaisesRegex(ValueError, 'WSL interop'):
            service.folder('C:\\Users\\me\\win11')

    def test_a_windows_codex_conversation_is_found_by_its_folder_and_start(self):
        with tempfile.TemporaryDirectory() as home:
            def rollout(day, stamp, sid, cwd):
                folder = Path(home, '.codex/sessions', day)
                folder.mkdir(parents=True, exist_ok=True)
                meta = {'timestamp': stamp, 'type': 'session_meta', 'payload': {'session_id': sid, 'id': sid, 'cwd': cwd,
                                                                                 'base_instructions': 'x' * 30000}}
                (folder / f'rollout-{sid}.jsonl').write_text(json.dumps(meta) + '\n{"type":"event"}\n')
            other = '01a12ebb-0000-7000-8000-000000000001'
            rollout('2026/10/18', '2026-10-18T10:00:00.100Z', SID, 'C:\\Users\\me\\win11')
            rollout('2026/10/19', '2026-10-19T09:00:00.000Z', other, 'C:\\Users\\me\\elsewhere')
            since = calendar.timegm((2026, 10, 18, 9, 0, 0))
            self.assertEqual(windows.codex_conversation(home, 'c:\\users\\me\\WIN11\\', since), SID)
            self.assertIsNone(windows.codex_conversation(home, 'C:\\Users\\me\\win11', since + 7200))
            self.assertIsNone(windows.codex_conversation(None, 'C:\\Users\\me\\win11', since))

    def test_encoding_is_what_powershell_reads(self):
        self.assertEqual(base64.b64decode(encoded('Get-Date; ü')).decode('utf-16-le'), 'Get-Date; ü')


class PanelWindowsTests(PanelCase):
    def windows(self):
        service = Mock()
        service.folder.return_value = '/mnt/c/Users/me/win11'
        service.command.side_effect = lambda agent, path, sid, resume, skip: f'start {agent} {path} {sid} {resume} {skip}'
        service.home.return_value = None
        self.panel._windows = service
        return service

    def test_a_windows_session_starts_powershell_and_is_marked(self):
        service = self.windows()
        self.panel.create_session = Mock()
        self.panel.tmux = Mock(return_value='')
        self.panel.session_exists = Mock(return_value=False)
        with patch.object(self.panel.uuid, 'uuid4', return_value=SID):
            self.assertEqual(self.panel.action_new({'name': 'win', 'agent': 'claude', 'runtime': 'windows',
                                                    'windows_path': 'C:\\Users\\me\\win11', 'skip': True}), {'name': 'win'})
        service.folder.assert_called_once_with('C:\\Users\\me\\win11')
        self.panel.create_session.assert_called_once_with('win', '/mnt/c/Users/me/win11', 'claude', True, SID,
                                                          f'start claude /mnt/c/Users/me/win11 {SID} False True')
        self.panel.tmux.assert_called_with('set-option', '-t', '=cc-win:', '@cc_runtime', 'windows')
        for wrong in ({'agent': 'kimi'}, {'agent': 'claude', 'source': {'kind': 'kimi'}}):
            with self.assertRaises(ValueError):
                self.panel.action_new({'name': 'win2', 'runtime': 'windows', 'windows_path': 'C:\\x', **wrong})

    def test_powershell_in_the_pane_means_the_windows_agent_runs(self):
        self.assertTrue(self.panel.is_running('claude', 'powershell.exe', 'windows'))
        self.assertFalse(self.panel.is_running('claude', 'bash', 'windows'))
        self.assertFalse(self.panel.is_running('shell', 'powershell.exe', 'windows'))
        self.assertFalse(self.panel.is_running('claude', 'powershell.exe'))

    def test_a_windows_session_comes_back_after_a_restart_in_windows(self):
        service = self.windows()
        self.panel.create_session = Mock()
        self.panel.tmux = Mock(return_value='')
        with patch.object(self.panel.os.path, 'isdir', return_value=True):
            self.panel.restore_session('win', {'path': '/mnt/c/Users/me/win11', 'agent': 'claude', 'sid': SID,
                                               'running': True, 'runtime': 'windows', 'title': 'Audit'})
        self.panel.create_session.assert_called_once_with('win', '/mnt/c/Users/me/win11', 'claude', False, SID,
                                                          f'start claude /mnt/c/Users/me/win11 {SID} True False')
        self.panel.tmux.assert_any_call('set-option', '-t', '=cc-win:', '@cc_runtime', 'windows')
        self.panel.tmux.assert_any_call('set-option', '-t', '=cc-win:', '@cc_title', 'Audit')
        service.status.assert_called_once_with()

    def test_a_windows_codex_session_learns_its_conversation_from_the_file(self):
        service = self.windows()
        service.home.return_value = '/mnt/c/Users/me'
        options = {'@cc_runtime': 'windows', '@cc_since': '1790000000'}
        self.panel.opt = Mock(side_effect=lambda name, key: options.get(key, ''))
        self.panel.tmux = Mock(return_value='/mnt/c/Users/me/win11\n')
        with patch('integrations.windows.codex_conversation', return_value=SID) as find:
            self.assertEqual(self.panel.windows_codex_sid('cx', 'codex', ''), SID)
            self.assertEqual(self.panel.windows_codex_sid('cx', 'codex', ''), '')  # Looked again only after a while.
        find.assert_called_once_with('/mnt/c/Users/me', 'C:\\Users\\me\\win11', 1789999995.0)
        self.panel.tmux.assert_any_call('set-option', '-t', '=cc-cx:', '@cc_sid', SID)
        self.assertEqual(self.panel.windows_codex_sid('cy', 'claude', ''), '')
        options['@cc_runtime'] = ''
        self.assertEqual(self.panel.windows_codex_sid('cz', 'codex', ''), '')

    def test_two_windows_codex_sessions_in_one_folder_do_not_learn_each_others_id(self):
        self.windows()
        self.panel.opt = Mock(side_effect=lambda name, key: {'@cc_runtime': 'windows'}.get(key, ''))
        def tmux(*args, **kwargs):
            if args[0] == 'list-sessions':
                return 'cc-cx\tcodex\twindows\t/mnt/c/Users/me/project\ncc-cy\tcodex\twindows\t/mnt/c/users/ME/PROJECT\n'
            return '/mnt/c/Users/me/project'
        self.panel.tmux = Mock(side_effect=tmux)
        with patch('integrations.windows.codex_conversation', return_value=SID) as find:
            self.assertEqual(self.panel.windows_codex_sid('cx', 'codex', ''), '')
            self.assertEqual(self.panel.windows_codex_sid('cy', 'codex', ''), '')
        find.assert_not_called()
        self.assertFalse(any(call.args[0] == 'set-option' for call in self.panel.tmux.call_args_list))

    def test_moving_to_windows_makes_a_new_session_with_the_summary(self):
        self.windows()
        options = {'@cc_agent': 'claude', '@cc_runtime': '', '@cc_skip': '0'}
        self.panel.opt = Mock(side_effect=lambda name, key: options.get(key, ''))
        self.panel.session_exists = Mock(side_effect=lambda name: name == 'audit')
        self.panel.tmux = Mock(return_value='/mnt/c/Users/me/win11\n')
        self.panel.create_session = Mock()
        self.panel.session_info = Mock(return_value={'summary': {'text': 'Listed startup items.'}})
        schedule = Mock()
        self.panel.schedule_service = Mock(return_value=schedule)
        result = self.panel.action_session_move({'name': 'audit', 'runtime': 'windows', 'windows_path': 'C:\\Users\\me\\win11'})
        self.assertEqual(result, {'name': 'audit-win', 'summary': True})
        name, text, trigger = schedule.add.call_args.args
        self.assertEqual((name, trigger), ('audit-win', 'idle'))
        self.assertIn('Listed startup items.', text)
        self.assertIn('ran in Linux (WSL)', text)
        self.assertIn('You now run in Windows (PowerShell), in C:\\Users\\me\\win11', text)
        self.assertIn('not carried over', text)
        with self.assertRaises(ValueError):
            self.panel.action_session_move({'name': 'audit', 'runtime': 'wsl'})


if __name__ == '__main__':
    unittest.main()
