"""Agents that run in Windows itself, started by DeckAway installed in WSL on the same computer.

Such a session's pane still belongs to tmux in WSL, so the screen, keys, permission questions and reconnecting
work as for any other; what runs in it is powershell.exe through WSL interop, and in it the Windows build of
the agent, in a folder on a Windows drive. Windows programs started this way run as the signed-in Windows
user, with the rights of the WSL instance that started them: unelevated by default, as administrator when
the installer was run with AGENT_DECK_WINDOWS_ADMIN=1 (its keep-alive task then runs with the highest rights).
"""
import base64
import calendar
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
# since then would not be found. Read again from the registry, as a new PowerShell window would, with
# PowerShell's and System32's own folders: Codex updates itself by calling powershell.exe by name.
FRESH_PATH = ("$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + "
              "[Environment]::GetEnvironmentVariable('Path','User') + ';' + $PSHOME + ';' + [Environment]::SystemDirectory")
# Programs Windows can start by themselves: npm also leaves a .ps1, which the default execution policy refuses,
# and an extensionless shell script, which PowerShell lists as an application but Windows only offers to open.
RUNNABLE = "Where-Object { $_.Extension -in '.exe','.cmd','.bat' }"
PROBE = (FRESH_PATH + "; $found = @(foreach ($n in 'claude','codex') { if (Get-Command $n -CommandType Application "
         "-ErrorAction SilentlyContinue | " + RUNNABLE + ") { $n } }); [Console]::OutputEncoding = [Text.Encoding]::UTF8; "
         "$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole("
         "[Security.Principal.WindowsBuiltInRole]::Administrator); "
         "@{version = $PSVersionTable.PSVersion.ToString(); home = $env:USERPROFILE; agents = $found; admin = $admin} | "
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
    found = candidates(environ, sockets)
    return {'WSL_INTEROP': found[0]} if found else {}


def candidates(environ=None, sockets=None):
    """Interop sockets, newest first: one per running wsl.exe, each starting Windows programs with its rights."""
    environ = os.environ if environ is None else environ
    found = sorted(glob.glob('/run/WSL/*_interop') if sockets is None else sockets, key=socket_age)
    current = environ.get('WSL_INTEROP', '')
    return ([current] if current and os.path.exists(current) else []) + [s for s in found if s != current][:3]


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
        # The classic renderer, as in WSL: tmux keeps no scrollback of the fullscreen one.
        lines.append("$env:CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = '1'")
        args = ['--resume' if resume else '--session-id', sid] if sid else []
    else:
        # No hook reports a Windows Codex conversation; until its file is found, the folder's latest one.
        # As in WSL, without the background server: an elevated Codex refuses to start one.
        args = ['--no-daemon', '--no-alt-screen', *((['resume', sid] if sid else ['resume', '--last']) if resume else [])]
    args += [flag] if skip else []
    lines += [f'$agent = (Get-Command {program} -CommandType Application -ErrorAction Stop | {RUNNABLE} | Select-Object -First 1).Source',
              f"if (-not $agent) {{ throw '{program} is not installed in Windows as a program (.exe or .cmd)' }}",
              '& $agent ' + ' '.join(quote(a) for a in args)]
    return '; '.join(lines)


CODEX_META = re.compile(r'"timestamp":\s*"([^"]+)".*?"type":\s*"session_meta".*?"id":\s*"([0-9a-f-]{36})"'
                        r'.*?"cwd":\s*"((?:[^"\\]|\\.)*)"')


def codex_conversation(home, folder, since, days=3):
    """The id of the newest Codex conversation started in a Windows folder since a moment (epoch seconds).
    Codex in Windows runs no DeckAway hook, so its conversation is found by the file it writes."""
    if not home or not folder:
        return None
    want, found = folder.rstrip('\\').lower(), []
    for day in sorted(glob.glob(os.path.join(home, '.codex', 'sessions', '*', '*', '*')))[-days:]:
        for path in glob.glob(os.path.join(day, 'rollout-*.jsonl')):
            meta = codex_meta(path)
            if meta and meta[2].rstrip('\\').lower() == want and meta[0] >= since:
                found.append(meta)
    return max(found)[1] if found else None


def codex_meta(path):
    """(started, id, cwd) from the first record of a conversation file; that record can be long."""
    try:
        with open(path, encoding='utf-8', errors='replace') as stream:
            head = stream.read(65536)
        match = CODEX_META.search(head.split('\n', 1)[0])
        if not match or not SID.match(match.group(2)):
            return None
        started = calendar.timegm(time.strptime(match.group(1)[:19], '%Y-%m-%dT%H:%M:%S'))
        return started, match.group(2), json.loads('"' + match.group(3) + '"')
    except (OSError, ValueError):
        return None


def encoded(text):
    """-EncodedCommand: WSL passes it to Windows untouched, where quotes in a plain argument would be mangled."""
    return base64.b64encode(text.encode('utf-16-le')).decode('ascii')


class Windows:
    def __init__(self, run=subprocess.run, clock=time.monotonic, wsl=in_wsl, find=powershell):
        self.run, self.clock, self.wsl, self.find = run, clock, wsl, find
        self.lock = threading.Lock()
        self.found = None  # (when, status)
        self.socket = None  # The interop socket agents are started through: an elevated one when there is one.

    def program(self):
        return self.find() if self.wsl() else None

    def status(self, again=False):
        """Whether Windows programs can be started from here, PowerShell's version, the Windows home folder,
        the agents installed there and whether they run as administrator; looked up at most once a minute."""
        with self.lock:
            if self.found and not again and self.clock() - self.found[0] < LOOK_AGAIN:
                return dict(self.found[1])
        status, socket = self.probe()
        with self.lock:
            self.found, self.socket = (self.clock(), status), socket
        return dict(status)

    def probe(self):
        program = self.program()
        if not program:
            return {'available': False}, None
        first = None
        for socket in candidates() or [None]:
            status = self.ask(program, socket)
            if status.get('admin'):
                return status, socket
            if first is None or (status.get('ready') and not first[0].get('ready')):
                first = (status, socket)
        return first

    def ask(self, program, socket):
        env = {**os.environ, **({'WSL_INTEROP': socket} if socket else {})}
        try:
            done = self.run([program, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(PROBE)],
                            input='', capture_output=True, text=True, timeout=30, env=env)
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
                'windows_home': data.get('home') if home else None, 'admin': data.get('admin') is True,
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
        with self.lock:
            socket = self.socket if self.socket and os.path.exists(self.socket) else None
        env = ''.join(f'{key}={shlex.quote(value)} ' for key, value in ({'WSL_INTEROP': socket} if socket else interop()).items())
        keep = ' -NoExit' if agent == 'shell' else ''
        return f'{env}{shlex.quote(program)} -NoLogo{keep} -EncodedCommand {encoded(ps)}'
