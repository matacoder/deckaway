"""What the DeckAway skills' scripts share: the project root, its profile, secrets from env files, masking."""
import json
import os
from pathlib import Path
import re
import ssl
import subprocess

SECRET = re.compile(r'(token|password|secret|key|env|buildargs|credential|private|auth)', re.I)
# python.org builds on macOS ship without CA roots; the system bundle is always there.
SYSTEM_CA = Path('/etc/ssl/cert.pem')


def root():
    try:
        found = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True,
                               timeout=10, input='').stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        found = ''
    return Path(found or os.getcwd())


def profile():
    path = root() / '.deckaway' / 'project.json'
    return json.loads(path.read_text()) if path.is_file() else {}


def read_env(path):
    values = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                values[key.strip().removeprefix('export ').strip()] = value.strip().strip('"\'')
    return values


def secrets(keys, files, optional=()):
    """keys from the process environment, then each file in order (relative ones from the project root)."""
    found = {}
    for file in files:
        path = Path(os.path.expanduser(file))
        for key, value in read_env(path if path.is_absolute() else root() / path).items():
            found.setdefault(key, value)
    values = {key: os.environ.get(key) or found.get(key, '') for key in (*keys, *optional)}
    missing = [key for key in keys if not values[key]]
    if missing:
        raise SystemExit(f"Missing {', '.join(missing)}: set them in one of {', '.join(map(str, files))} (0600).")
    return values


def ssl_context():
    if ssl.get_default_verify_paths().cafile is None and SYSTEM_CA.is_file():
        return ssl.create_default_context(cafile=str(SYSTEM_CA))
    return ssl.create_default_context()


def mask(value):
    """Secret-looking fields of an API answer, hidden before anything is printed."""
    if isinstance(value, dict):
        return {k: ('***' if SECRET.search(k) and not k.endswith('Id') and v else mask(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [mask(v) for v in value]
    return value
