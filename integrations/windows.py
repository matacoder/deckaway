"""Agents that run in Windows itself, started by DeckAway installed in WSL on the same computer.

Such a session's pane still belongs to tmux in WSL, so the screen, keys, permission questions and reconnecting
work as for any other; what runs in it is powershell.exe through WSL interop, and in it the Windows build of
the agent, in a folder on a Windows drive. Windows programs started this way run as the signed-in Windows
user and are never elevated (the installer starts WSL unelevated): a step that needs administrator rights
shows the UAC prompt on that computer's screen, where a person has to approve it.
"""
import base64
import glob
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import threading
import time

POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
# What Windows sessions may run: (program, flag that skips the agent's own permission questions).
AGENTS = {'claude': ('claude', '--dangerously-skip-permissions'),
          'codex': ('codex', '--dangerously-bypass-approvals-and-sandbox'),
          'shell': (None, '')}
DRIVE = re.compile(r'/mnt/([a-z])(/[^\x00-\x1f]*)?\Z')
WINDOWS = re.compile(r'([A-Za-z]):([\\/][^\x00-\x1f<>"|?*]*)?\Z')
SID = re.compile(r'[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z')
LOOK_AGAIN = 60
# The PATH of a process started through WSL is the one Windows had when WSL started: an agent installed
# since then would not be found. Read again from the registry, as a new PowerShell window would.
FRESH_PATH = ("$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + "
              "[Environment]::GetEnvironmentVariable('Path','User')")
# Applications only: an npm-installed agent also leaves a .ps1, which the default execution policy refuses.
PROBE = (FRESH_PATH + "; $found = @(foreach ($n in 'claude','codex') { if (Get-Command $n -CommandType Application "
         "-ErrorAction SilentlyContinue) { $n } }); [Console]::OutputEncoding = [Text.Encoding]::UTF8; "
         "@{version = $PSVersionTable.PSVersion.ToString(); home = $env:USERPROFILE; agents = $found} | "
         "ConvertTo-Json -Compress")


def in_wsl():
    try:
        return 'microsoft' in Path('/proc/version').read_text(errors='replace').lower()
    except OSError:
        return False


def powershell():
    return shutil.which('powershell.exe') or (POWERSHELL if os.access(POWERSHELL, os.X_OK) else None)


def interop(environ=None, sockets=None):
    """The variable that lets a process reach Windows. A service started by systemd has none, and then every
    Windows program fails with "UtilBindVsockAnyPort: socket failed"; WSL's own socket is named instead."""
    environ = os.environ if environ is None else environ
    current = environ.get('WSL_INTEROP', '')
    if current and os.path.exists(current):
        return {}
    found = sorted(glob.glob('/run/WSL/*_interop') if sockets is None else sockets, key=socket_age)
    return {'WSL_INTEROP': found[0]} if found else {}


def socket_age(path):
    try:
        return -os.stat(path).st_mtime
    except OSError:
        return 0


def to_windows(path):
    """/mnt/c/Users/me -> C:\\Users\\me; None for a folder that is not on a Windows drive."""
    match = DRIVE.match(os.path.normpath(path)) if isinstance(path, str) else None
    if not match:
        return None
    return match.group(1).upper() + ':' + (match.group(2) or '\\').replace('/', '\\')


def to_linux(text):
    """C:\\Users\\me -> /mnt/c/Users/me, refusing anything but a plain absolute path."""
    match = WINDOWS.match(text.strip()) if isinstance(text, str) else None
    if not match:
        raise ValueError('Укажите папку Windows целиком, например C:\\Users\\me\\project')
    parts = [p for p in re.split(r'[\\/]', match.group(2) or '') if p]
    if any(p in ('.', '..') or p.endswith((' ', '.')) for p in parts):
        raise ValueError('В пути к папке Windows не может быть . и ..')
    return '/'.join(['/mnt', match.group(1).lower(), *parts])


def quote(text):
    return "'" + text.replace("'", "''") + "'"


def script(agent, folder, sid=None, resume=False, skip=False):
    """What PowerShell runs: the agent in the folder, or PowerShell itself for a terminal."""
    if agent not in AGENTS:
        raise ValueError('В Windows запускаются только Claude, Codex и терминал')
    program, flag = AGENTS[agent]
    lines = [FRESH_PATH, 'Set-Location -LiteralPath ' + quote(folder)]
    if program is None:
        return '; '.join(lines)
    if sid is not None and not SID.match(str(sid)):
        raise ValueError('Invalid conversation ID')
    if agent == 'claude':
        args = ['--resume' if resume else '--session-id', sid] if sid else []
    else:
        if resume and not sid:
            raise ValueError('ID разговора Codex не сохранён: продолжите его в терминале через codex resume')
        args = ['--no-alt-screen', *(['resume', sid] if resume else [])]
    args += [flag] if skip else []
    lines += [f'$agent = (Get-Command {program} -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source',
              '& $agent ' + ' '.join(quote(a) for a in args)]
    return '; '.join(lines)


def encoded(text):
    """-EncodedCommand: WSL passes it to Windows untouched, where quotes in a plain argument would be mangled."""
    return base64.b64encode(text.encode('utf-16-le')).decode('ascii')


class Windows:
    def __init__(self, run=subprocess.run, clock=time.monotonic, wsl=in_wsl, find=powershell):
        self.run, self.clock, self.wsl, self.find = run, clock, wsl, find
        self.lock = threading.Lock()
        self.found = None  # (when, status)

    def program(self):
        return self.find() if self.wsl() else None

    def status(self, again=False):
        """Whether Windows programs can be started from here, PowerShell's version, the Windows home folder
        and the agents installed there; looked up at most once a minute."""
        with self.lock:
            if self.found and not again and self.clock() - self.found[0] < LOOK_AGAIN:
                return dict(self.found[1])
        status = self.probe()
        with self.lock:
            self.found = (self.clock(), status)
        return dict(status)

    def probe(self):
        program = self.program()
        if not program:
            return {'available': False}
        try:
            done = self.run([program, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(PROBE)],
                            input='', capture_output=True, text=True, timeout=30, env={**os.environ, **interop()})
            data = json.loads(done.stdout.strip().splitlines()[-1]) if done.returncode == 0 and done.stdout.strip() else None
        except (OSError, ValueError, IndexError, subprocess.SubprocessError) as error:
            return {'available': True, 'ready': False, 'error': f'{type(error).__name__} while starting PowerShell'}
        if not isinstance(data, dict):
            vsock = 'UtilBindVsock' in (done.stderr or '')
            return {'available': True, 'ready': False, 'error': 'WSL could not start Windows programs (WSL interop)'
                    if vsock else f'PowerShell exited with code {done.returncode}'}
        agents = data.get('agents') or []
        home = to_linux(data['home']) if isinstance(data.get('home'), str) and WINDOWS.match(data['home']) else None
        return {'available': True, 'ready': True, 'version': str(data.get('version') or ''), 'home': home,
                'windows_home': data.get('home') if home else None,
                'agents': [a for a in (agents if isinstance(agents, list) else [agents]) if a in AGENTS]}

    def home(self):
        """The Windows user's folder as WSL sees it, if known: where the Windows agents keep conversations."""
        with self.lock:
            return self.found[1].get('home') if self.found else None

    def folder(self, text):
        """A folder for a new session: inside the Windows user's folder, made if missing."""
        status = self.status()
        if not status.get('ready'):
            raise ValueError(f"Windows недоступен с этого компьютера: {status.get('error') or 'not WSL'}")
        path, home = to_linux(text), status.get('home')
        if not home or not (path == home or path.startswith(home + '/')):
            raise ValueError('Папка должна быть внутри ' + (status.get('windows_home') or 'C:\\Users'))
        if os.path.islink(path) or (os.path.exists(path) and not os.path.isdir(path)):
            raise ValueError('Это не папка')
        os.makedirs(path, exist_ok=True)
        return path

    def command(self, agent, folder, sid=None, resume=False, skip=False):
        """The line typed into the pane's shell in WSL."""
        program = self.program()
        if not program:
            raise ValueError('Windows недоступен с этого компьютера')
        windows = to_windows(folder)
        if not windows:
            raise ValueError('Папка сессии не на диске Windows')
        ps = script(agent, windows, sid, resume, skip)
        env = ''.join(f'{key}={shlex.quote(value)} ' for key, value in interop().items())
        keep = ' -NoExit' if agent == 'shell' else ''
        return f'{env}{shlex.quote(program)} -NoLogo{keep} -EncodedCommand {encoded(ps)}'
