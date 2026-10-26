import unittest

from integrations.sign_in_help import show_again_command

GREP = 'grep -h -e ^PANEL_USER= -e ^PANEL_PASSWORD='


class ShowAgainTests(unittest.TestCase):
    def test_each_kind_of_install_gets_a_command_for_its_own_terminal(self):
        self.assertEqual(show_again_command('linux', {}, wsl=False),
                         f"sudo sh -c '{GREP} /home/*/.config/cc-panel/env'")
        self.assertEqual(show_again_command('darwin', {}, wsl=False),
                         "grep -e '\"PANEL_USER\"' -e '\"PANEL_PASSWORD\"' ~/.config/cc-panel/macos.json")
        self.assertEqual(show_again_command('linux', {'AGENT_DECK_CONTAINER': '1'}, wsl=False),
                         f"docker compose exec agent-deck sh -c '{GREP} \"$HOME/.config/cc-panel/env\"'")

    def test_windows_gets_a_powershell_line_for_its_distribution(self):
        self.assertEqual(show_again_command('linux', {}, wsl=True),
                         f"wsl -d Ubuntu-24.04 -u root -- sh -c '{GREP} /home/*/.config/cc-panel/env'")
        self.assertTrue(show_again_command('linux', {'WSL_DISTRO_NAME': 'Debian'}, wsl=True).startswith('wsl -d Debian '))

    def test_no_command_names_the_account(self):
        for platform, environ, wsl in (('linux', {}, False), ('darwin', {}, False), ('linux', {}, True),
                                       ('linux', {'AGENT_DECK_CONTAINER': '1'}, False)):
            command = show_again_command(platform, {**environ, 'USER': 'alice'}, wsl=wsl)
            self.assertNotIn('alice', command)
            self.assertNotIn('/home/dev', command)

    def test_the_command_finds_the_values_in_an_env_file(self):
        import subprocess
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as home:
            env = Path(home) / 'env'
            env.write_text('BIND_PORT=8790\nPANEL_USER=dev\nPANEL_PASSWORD=Abc-1_x\nTTYD_SOCK=/x\n')
            found = subprocess.run(['sh', '-c', f'{GREP} {env}'], input='', capture_output=True, text=True, check=True)
        self.assertEqual(found.stdout, 'PANEL_USER=dev\nPANEL_PASSWORD=Abc-1_x\n')


if __name__ == '__main__':
    unittest.main()
