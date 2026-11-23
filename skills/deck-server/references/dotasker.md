# Dotasker for a client

Dotasker (github.com/matacoder/dotasker) is a small tracker the client's staff use from the browser and
Telegram, with an agent API that `deck-support/scripts/tracker.py` speaks. One instance per client, on the
client's server.

1. A compose app from the repo in Dokploy (the owner's GitHub provider sees it), on `tasks.<client domain>` with
   HTTPS. Its README lists the env; read it from the repo, do not guess.
2. The agent key is made on the agent's side: generate a random key locally, put only its hash in the server's
   env (`SETUP_AGENT_KEY_HASH`), keep the key in the project's `.env` as `DOTASKER_AGENT_KEY` with
   `DOTASKER_URL`. The key never travels to the server.
3. Its Telegram bot is the client's own; Dotasker reads that bot's updates (for `/login`), so no other poller may
   use the same bot.
4. Backups: its database volume, as in `backups.md`.
5. Profile: `"tracker": {"kind": "dotasker"}` (defaults: `.env`, `DOTASKER_URL`, `DOTASKER_AGENT_KEY`).
   Check: `python3 <deck-support>/scripts/tracker.py list`.
