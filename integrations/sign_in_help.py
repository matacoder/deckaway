"""The command that shows the panel's login and password again, for the sign-in page.

The installer prints both once; whoever closed that window needs a way back that works on this computer.
The command never names the account: the login page must not reveal half of the sign-in.
"""
import os
from pathlib import Path
import sys

DEFAULT_DISTRO = 'Ubuntu-24.04'  # What install-windows.ps1 installs unless told otherwise.
# Plain words only: the same text is typed into PowerShell, bash and zsh, which quote differently.
GREP = 'grep -h -e ^PANEL_USER= -e ^PANEL_PASSWORD='
LINUX = f"sh -c '{GREP} /home/*/.config/cc-panel/env'"


def in_wsl():
    try:
        return 'microsoft' in Path('/proc/version').read_text(errors='replace').lower()
    except OSError:
        return False


def show_again_command(platform=None, environ=None, wsl=None):
    """A command for the terminal of this computer (PowerShell on Windows) that prints login and password."""
    platform = sys.platform if platform is None else platform
    environ = os.environ if environ is None else environ
    if environ.get('AGENT_DECK_CONTAINER'):
        return f"docker compose exec agent-deck sh -c '{GREP} \"$HOME/.config/cc-panel/env\"'"
    if platform == 'darwin':
        return "grep -e '\"PANEL_USER\"' -e '\"PANEL_PASSWORD\"' ~/.config/cc-panel/macos.json"
    if in_wsl() if wsl is None else wsl:
        distro = environ.get('WSL_DISTRO_NAME') or DEFAULT_DISTRO
        return f'wsl -d {distro} -u root -- {LINUX}'
    return f'sudo {LINUX}'
