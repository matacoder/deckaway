# Reading sources

Every source has a cursor: the newest id handled. Keep cursors outside the repo, in
`~/.cache/deckaway/<project>/<source id>`. Read everything above the cursor, handle it, then write the newest
handled id. First run: the last 24 hours.

## Telegram

- **Through the owner's account** (`reader: my-telegram`, read-only, installed separately on the computer that
  holds the login; duty that needs it runs on that computer):
  ```bash
  TG=("$HOME/.local/share/my-telegram/venv/bin/python" "$HOME/.claude/skills/my-telegram/scripts/tg.py")
  "${TG[@]}" history <chat> --topic <topic> --limit 50 --save <scratch>/tg --files
  ```
  Staff who write to the owner directly: a watch list (`watch.py inbox <list> --save … --files`, then
  `--commit`). A request from a direct message becomes a task without a chat source, announced in the
  project's task topic. Never write into the direct chat: the owner answers there. Personal matters go nowhere.
- **Through a bot**: a bot sees what it is allowed to (group privacy). A bot whose updates another service
  already reads (Dotasker's own `/login`) must not be polled a second time: it would steal the updates.
- Pages: read until the cursor, not just the last page (a busy chat overflows `--limit`).
- Voice and video: transcribe locally; attach the transcript to the task.

## Monitoring

| Source | Read with | Note |
|---|---|---|
| Uptime Kuma | its alert topic in the chat, or its status page | Down → Up within minutes needs nothing; down longer, or flapping → a task |
| Beszel | `python3 DECK/scripts/beszel.py systems` / `alerts` / `containers` | `BESZEL_URL/EMAIL/PASSWORD` in env, `./.env` or `~/.config/beszel/env` |
| Bugsink | `python3 DECK/scripts/bugsink.py issues` | `BUGSINK_URL/API_TOKEN`; a new unresolved issue in production → a task with its link |
| Logs | `python3 DECK/scripts/logs.py query '<LogsQL>' --since 1h` | VictoriaLogs; see deck-server for setup |
| Dokploy | the project's Dokploy helper, read-only | failed builds → a task |

Correlate: an alert + an error in Bugsink + log lines around the same minute make one task, not three.

## Other sources

`kind: command`: the profile's `read` command prints new items and keeps its own cursor (Bitrix24, a client
suggestions form, a mailbox). Same rules: handle, then commit.
