# The project profile: `.deckaway/`

Committed in the project's own repo, next to its code. No secrets: only the names of the env keys that hold them.
Both `deck-support` and `deck-next-task` read it.

## `project.json`

```json
{
  "name": "1826",
  "language": "ru",
  "owner": {"name": "Denis", "telegram_id": 128538062},
  "tracker": {"kind": "dotasker", "env": ".env", "url": "DOTASKER_URL", "key": "DOTASKER_AGENT_KEY"},
  "sources": [
    {"id": "tasks", "kind": "telegram", "chat": -1004429079537, "topic": 21, "reader": "my-telegram",
     "what": "every request is a task"},
    {"id": "downtime", "kind": "alerts", "chat": -1004429079537, "topic": 2, "reader": "my-telegram",
     "what": "Uptime Kuma: down for over 15 minutes or flapping -> a task"},
    {"id": "logs", "kind": "victorialogs", "env": "~/.config/victorialogs/1826.env"}
  ],
  "reply": {"via": "bot", "command": "python3 scripts/tg_say.py --thread {thread} --reply {msg} {text}"},
  "servers": [{"name": "prod", "dokploy_env": "~/.config/dokploy/1826.env", "ssh": "deploy@1.2.3.4"}],
  "fresh_data": "scripts/db_refresh.sh",
  "trees": {"prefix": "k", "count": 6, "duty": 6, "commands": {"take": "scripts/tree.sh take",
            "land": "scripts/tree.sh land", "finish": "scripts/tree.sh finish", "list": "scripts/tree.sh list"}},
  "checks": "just check",
  "autonomy": {"reply": "auto", "push": "ask", "deploy": "ask", "close_tasks": "auto"},
  "executors": "all",
  "quiet_hours": "23:00-08:00"
}
```

| Field | Meaning |
|---|---|
| `tracker.kind` | `dotasker` (built in), `command` (`"verbs": {"list": "python3 scripts/board.py list", …}`: each verb's command, the arguments are appended), `mcp` (`"tools": {"create": "<mcp tool>", …}` and a `"fallback"` command profile for agents without that MCP) |
| `sources[].kind` | `telegram`, `alerts`, `bitrix`, `kuma`, `beszel`, `bugsink`, `victorialogs`, `command` (`"read"`: a command printing new items since its own cursor) |
| `sources[].reader` | how to read it: `my-telegram` (the owner's account, read-only), `bot` (a bot poller), a command |
| `reply` | who answers in chats and how; `{thread}`, `{msg}`, `{text}` are filled in |
| `autonomy` | `auto` or `ask` per action. Defaults when missing: reply `auto`, push `ask`, deploy `ask`, close_tasks `auto` |
| `executors` | `"all"` (default: every vendor may see the code) or a list of harnesses allowed for this client |
| `trees` | worktree pool for `deck-next-task`: `prefix`+number, the duty tree, the project's own tree commands; without `commands`, `deck-next-task/references/worktrees.md` gives plain git ones |

Unknown fields are allowed: keep what the project needs.

## `support.md` and `next-task.md`

Prose for what does not fit JSON:
- **Owner's instructions**: dated, in their words, newest last. Never delete one; a later one may override.
- Topic-by-topic rules, the ask-first list, tone, who is who (staff names and roles, no personal data).
- What the alerts look like and what each needs.
- For next-task: the queue's priorities, who orders it, what is never taken.
