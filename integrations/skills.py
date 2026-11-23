"""DeckAway's own skills (support duty, next task, server setup), put where every agent finds them.

The skills are written in `skills/` and shipped inside the release as `skill_bundle.py` (the updater accepts
Python modules only). At start the panel copies them into each installed agent's skills folder: Claude Code
(and Kimi, GLM through it) reads `~/.claude/skills`, Codex `$CODEX_HOME/skills`. A folder of that name without
our marker is the owner's own and is never touched; ours are replaced whole when the version changes, and
removed when a release no longer has them. The session hook tells the agent they are there (`agent_note`).
"""
import os
from pathlib import Path
import shutil
import tempfile

MARKER = '.deckaway-skill'
NAMES = {
    'deck-support': 'support duty: read the chats and monitoring, answer, file and close tasks',
    'deck-next-task': 'take the next tasks and deliver them, delegating to other agents in work trees',
    'deck-server': 'set up a server: Dokploy, Uptime Kuma, Beszel, Bugsink, VictoriaLogs, backups',
}


def bundle():
    from integrations import skill_bundle
    return skill_bundle.VERSION, skill_bundle.FILES


def targets(home=None, environ=os.environ):
    """Skills folders of the agents installed here: only where the agent's own folder already exists."""
    home = Path(home or Path.home())
    codex = Path(environ['CODEX_HOME']) if environ.get('CODEX_HOME') else home / '.codex'
    return [folder / 'skills' for folder in (home / '.claude', codex) if folder.is_dir() and not folder.is_symlink()]


def ours(folder):
    marker = folder / MARKER
    return folder.is_dir() and not folder.is_symlink() and marker.is_file() and not marker.is_symlink()


def write(root, name, version, files):
    """The skill in a hidden folder next to it first, then swapped in: an agent never reads half of one."""
    stage = Path(tempfile.mkdtemp(prefix=f'.{name}-', dir=root))
    try:
        for path, text in files.items():
            target = stage / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
            target.chmod(0o755 if path.startswith('scripts/') and path.endswith('.py') else 0o644)
        (stage / MARKER).write_text(version + '\n')
        stage.chmod(0o755)
        old = root / name
        if old.exists():
            shutil.rmtree(old)
        stage.rename(old)
    finally:
        if stage.exists():
            shutil.rmtree(stage, ignore_errors=True)


def install(home=None, environ=os.environ):
    """-> {folder: 'installed' | 'current' | 'foreign' | 'removed'} for every skill in every agent's folder."""
    version, files = bundle()
    skills = {}
    for path, text in files.items():
        name, _, rest = path.partition('/')
        skills.setdefault(name, {})[rest] = text
    done = {}
    for root in targets(home, environ):
        root.mkdir(mode=0o755, exist_ok=True)
        for name, content in skills.items():
            folder = root / name
            if (folder.exists() or folder.is_symlink()) and not ours(folder):
                done[str(folder)] = 'foreign'
            elif folder.exists() and (folder / MARKER).read_text().strip() == version:
                done[str(folder)] = 'current'
            else:
                write(root, name, version, content)
                done[str(folder)] = 'installed'
        for folder in root.glob('deck-*'):
            if folder.name not in skills and ours(folder):
                shutil.rmtree(folder)
                done[str(folder)] = 'removed'
    return done


def agent_note(agent=''):
    version, _ = bundle()
    where = '$CODEX_HOME/skills' if agent == 'codex' else '~/.claude/skills'
    lines = [f'DeckAway skills ({version}), in {where}: when a task matches one, read its SKILL.md first.']
    lines += [f'- {name}: {what}' for name, what in NAMES.items()]
    lines.append('Their project settings are in .deckaway/ at the repo root (deck-support explains it).')
    return '\n'.join(lines)
