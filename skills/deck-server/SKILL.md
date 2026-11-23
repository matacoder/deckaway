---
name: deck-server
description: Put a client's server under management and observation, with any agent — given SSH access, install Dokploy and make an API key for itself, deploy Uptime Kuma, Beszel, Bugsink and VictoriaLogs (container logs that survive redeploys), optionally Dotasker as the task tracker, set up S3 backups of everything and prove a restore, route alerts to the client's chat, and write the project profile's sources so deck-support reads them. Also adds VictoriaLogs to a server that already runs Dokploy. Use for "set up the server", "поставь мониторинг", "разверни докплой", "поставь логи", "VictoriaLogs", "бэкапы", "разверни dotasker".
---

# Server: management, monitoring, logs, backups

`DECK` is this skill's folder. Keys live in `~/.config/dokploy/<host>.env` (0600), never in the repo, a
command line or the chat. Every write is preceded by "was → will be" and follows the profile's `autonomy`
(default: ask the owner, through a decision, before the first write on a server).

## 0. Preflight (read only)

`ssh <server>`: OS and version, CPU/RAM/disk, open ports (80/443 must be free for Dokploy's Traefik), what
already runs (`docker ps`), whether Dokploy is there. Report it; stop if the server is not dedicated to this
(another web server on 80/443, someone else's containers): ask first.

## 1. Dokploy

- Not installed → the official installer (`curl -sSL https://dokploy.com/install.sh | sh`) after the owner's
  yes. Then the first admin user is created in its web UI by the owner (the password stays with them).
- An API key for the agent: Dokploy → Settings → Profile → API keys, made by the owner or with the admin
  session. Store it as `DOKPLOY_URL` + `DOKPLOY_TOKEN` in `~/.config/dokploy/<host>.env`, 0600.
- Check it: `python3 DECK/scripts/dokploy.py --env ~/.config/dokploy/<host>.env get project.all`.
- Compose rules on Dokploy: `expose`, not `ports`; services on the external `dokploy-network`; a healthcheck on
  `127.0.0.1`; named volumes; `restart: always`; log limits. Traefik routes only healthy containers.

## 2. Monitoring

Each through Dokploy (a template, or a compose app with a pinned image), on its own domain with HTTPS:
- **Uptime Kuma**: a monitor per public URL and per API health endpoint; notifications to the client's alert
  topic (a Telegram bot in that chat).
- **Beszel**: hub plus an agent on every server; alerts for CPU, memory and disk over 85%; a read-only user for
  the agent (`BESZEL_URL/EMAIL/PASSWORD`).
- **Bugsink**: one project per app, its DSN in the app's env (`SENTRY_DSN`); an API token for the agent
  (`BUGSINK_URL/API_TOKEN`); new issues to the errors topic.

Credentials for the agent go to `~/.config/<tool>/<project>.env` or the project's `.env`, 0600.

## 3. Logs: VictoriaLogs

`DECK/references/victorialogs.md`. Every project gets it (owner, 2026-11-23). Then add the `victorialogs`
source to the profile and check `python3 <deck-support>/scripts/logs.py containers --since 1h` lists the apps.

## 4. Backups

`DECK/references/backups.md`. The S3 keys come from the owner: file a decision asking for an S3 endpoint,
bucket, access key and secret, entered by the owner into `~/.config/dokploy/<host>.env` (never in the chat).
No backup counts until one restore was proven.

## 5. Task tracker (when the client has none)

`DECK/references/dotasker.md`: Dotasker on the client's server, its agent key made locally.

## 6. Hand over

- Write the profile's `servers` and `sources` (Kuma topic, Beszel, Bugsink, logs) in `.deckaway/project.json`.
- Report: what runs where (URL per service), what is monitored, where the backups go and when the restore was
  proven, which keys exist and where they are kept (paths, never values).

## Rules

- Touch only the server and project you were given. Dokploy `server.*`, `settings.*`, `cluster.*` writes
  affect every project: only on an explicit request.
- Deletes, stops, restarts, rollbacks, key rotation: only with the owner's yes.
- After a write: read the state again and compare. Env and mounts apply on the next deploy.
- Never work around a 401 or 403: report which right is missing.
