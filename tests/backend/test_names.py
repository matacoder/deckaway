from unittest.mock import Mock, patch

from support import PanelCase
from integrations.names import unique_name
from integrations.lmstudio import LMStudio


class NamingTests(PanelCase):
    def test_collision_suffixes_are_bounded_and_retried(self):
        with patch('integrations.names.secrets.randbelow', side_effect=[1, 2]):
            self.assertEqual(unique_name('x' * 32, lambda name: name in ('x' * 32, 'x' * 27 + '-1001'), 32), 'x' * 27 + '-1002')
        self.assertEqual(unique_name('free', lambda name: False, 32), 'free')

    def test_duplicate_session_creation_returns_actual_id(self):
        self.panel.session_exists = Mock(side_effect=lambda name: name == 'demo')
        self.panel.resolve_path = Mock(return_value=str(self.home))
        self.panel.create_session = Mock()
        with patch('integrations.names.secrets.randbelow', return_value=17):
            result = self.panel.action_new({'name':'demo', 'agent':'shell'})
        self.assertEqual(result, {'name':'demo-1017'})
        self.assertEqual(self.panel.create_session.call_args.args[0], 'demo-1017')

    def test_a_slow_clone_does_not_hold_other_new_sessions_and_names_stay_unique(self):
        import threading
        cloning, done = threading.Event(), threading.Event()
        def resolve(d, name):
            if d.get('slow'):
                cloning.set()
                done.wait(5)
            return str(self.home)
        self.panel.session_exists = Mock(return_value=False)
        self.panel.resolve_path = Mock(side_effect=resolve)
        self.panel.create_session = Mock()
        slow = threading.Thread(target=self.panel.action_new, args=({'name': 'demo', 'agent': 'shell', 'slow': True},))
        slow.start()
        self.assertTrue(cloning.wait(5))
        with patch('integrations.names.secrets.randbelow', return_value=17):
            self.assertEqual(self.panel.action_new({'name': 'demo', 'agent': 'shell'}), {'name': 'demo-1017'})
        done.set()
        slow.join(5)
        self.assertEqual(sorted(call.args[0] for call in self.panel.create_session.call_args_list), ['demo', 'demo-1017'])
        self.assertEqual(self.panel.creating_names, set())

    def test_duplicate_connections_and_edits_keep_ids_and_credentials(self):
        service = LMStudio(self.home / 'models')
        first = service.save({'name':'Mac', 'url':'http://127.0.0.1:1234', 'key':'test-only'})
        with patch('integrations.names.secrets.randbelow', return_value=42):
            second = service.save({'name':'mac', 'url':'http://127.0.0.1:1234'})
        self.assertEqual(second['name'], 'mac-1042')
        updated = service.save({'id': first['id'], 'name':'Mac', 'url':'http://127.0.0.1:1234'})
        self.assertEqual(updated['id'], first['id'])
        self.assertEqual(service.get(first['id'])['key'], 'test-only')

    def test_rename_only_changes_title_and_restores_it_after_restart(self):
        self.panel.session_exists = Mock(return_value=True)
        self.panel.list_sessions = Mock(return_value=[{'name':'demo','title':'Old'}])
        self.panel.tmux = Mock(return_value='')
        self.assertEqual(self.panel.action_rename({'name':'demo','title':'Новая работа'}), {'name':'demo','title':'Новая работа'})
        self.panel.tmux.assert_called_once_with('set-option','-t','=cc-demo:','@cc_title','Новая работа')
        self.panel.tmux.reset_mock()
        self.panel.create_session = Mock()
        self.panel.restore_session('demo', {'path':str(self.home),'agent':'shell','title':'Новая работа'})
        self.panel.tmux.assert_called_once_with('set-option','-t','=cc-demo:','@cc_title','Новая работа')
        self.panel.tmux.return_value=f'cc-demo\t{self.home}\tbash\t\t0\t1\tshell\t\tНовая работа\n'
        self.assertEqual(self.panel.live_sessions()['demo']['title'], 'Новая работа')
        self.panel.tmux.return_value=f'cc-demo\t{self.home}\tbash\t\t0\t1\tshell\t\t\t\t\tFix login\n'
        self.assertEqual({k: v for k, v in self.panel.live_sessions()['demo'].items() if 'title' in k}, {'auto_title': 'Fix login'})
        for invalid in ('', 'x\ny', 'x'*101):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.panel.action_rename({'name':'demo','title':invalid})

    def test_a_model_title_comes_back_after_a_reboot_and_a_pinned_own_name_is_no_rename(self):
        self.panel.create_session = Mock()
        self.panel.tmux = Mock(return_value='')
        self.panel.restore_session('demo', {'path': str(self.home), 'agent': 'shell', 'title': 'demo', 'auto_title': 'Fix login'})
        self.panel.tmux.assert_called_once_with('set-option', '-t', '=cc-demo:', '@cc_auto_title', 'Fix login')
        # A session an earlier version restored with its own name as the owner's title takes a model's title again.
        self.panel.network_settings.get = Mock(return_value={})
        self.panel.opt = Mock(side_effect=lambda name, option: {'@cc_title': 'demo'}.get(option, ''))
        self.panel.tmux.reset_mock()
        self.assertEqual(self.panel.keep_auto_title('demo', 'Fix login'), 'fix-login')
        self.panel.tmux.assert_called_once_with('set-option', '-t', '=cc-demo:', '@cc_auto_title', 'fix-login', check=False)
        self.panel.opt = Mock(side_effect=lambda name, option: {'@cc_title': 'Моя работа'}.get(option, ''))
        self.assertEqual(self.panel.keep_auto_title('demo', 'Fix login'), '')
