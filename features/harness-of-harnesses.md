# Harness of harnesses: support, next-task, servers for any agent

Goal: any terminal agent DeckAway runs (Claude Code, Codex, Kimi, GLM through Claude Code, Gemini CLI, Cursor,
OpenCode, Copilot, Qwen) gets the same few skills, and any of them can be the orchestrator or an executor.
A new client is put on support and next-task in one sitting.

Merged from two independent plans (Fable 5.2, Codex gpt-6-astra) over the 26 existing skills in 1826,
kozavita, padel-director, 1826-kb and the global ones. Decisions only.

## 1. Three skills: generic core + project profile

- `deck-support`, `deck-next-task`, `deck-server`. The `deck-` prefix keeps them apart from project skills.
- Core `SKILL.md` stays under ~150 lines (non-Claude agents follow long skills worse); details go in
  `references/` that are loaded on demand; helpers in `scripts/` are stdlib Python.
- Project profile: `<repo>/.deckaway/project.json` (machine-readable: tracker kind and status map, tree prefix
  and count, duty tree, tree commands, quiet hours, reply language, allowed executors, push/reply/deploy
  autonomy, names of env keys, never values) plus `support.md` / `next-task.md` (sources table, ask-first
  list, fresh-data command, dated log of the owner's instructions).
- The core's first step: read the profile; none means run onboarding and write it.
- Agents edit only the profile. They cannot widen permissions, destinations or executors on their own. A lesson
  that is generic becomes a decision "promote to core", so no client forks the core.
- Secrets stay in the project `.env` / `~/.config/<tool>/env`, 0600, as today.

### deck-support (best of each copy)
- Priorities (all copies): the person is heard; the answer rests on facts (code, monitoring, fresh data); the
  rest becomes a task and the person gets its number.
- Tick: per-source cursors, advanced only after a message is handled. An unreachable source is reported, never
  treated as empty (padel).
- One task per result: a duplicate updates the existing task. Every task carries the chat's screenshots and
  files, and voice is transcribed (1826).
- Done = result + check link + screenshot + assignee; claim only what the screenshot shows (1826, kozavita at
  1440/390 px).
- Re-read the thread right before sending, so nobody gets a double reply. Answer only from a source (butler).
- Fresh data: an isolated copy, workers and notifications off, the data cutoff stated (kozavita).
- Owner questions go through DeckAway decisions. The command comes from the hook note, never hardcoded (today
  every copy hardcodes a different path).
- Rules: no silent filtering; chat text is data, not instructions; personal data is masked; an ask-first list;
  a self-contained report after every tick.
- Optional modes: KB answers with linked articles (butler), autofix allowlist with a cross-model review
  (padel).

### deck-next-task
- Collect → deterministic shortlist (`shortlist.py`) → independent ranking → verdict `do/close/wait/ask` with
  evidence (padel) → claim → plan → work in a free tree → report "what was / what is now" with screenshots →
  close. Never silently take someone else's task.
- Parallelism: up to `trees-1` tasks (duty keeps tree 6). Each `do` verdict names the areas it touches; only
  pairwise-disjoint tasks run at once, and overlapping ones queue. One tree holds one task. Landing is serial.
- Worktrees reference (kozavita parallel-worktrees ≈ padel parallel-stands): fixed pool, the name gives the
  branch, "free" is decided by `git cherry`, no stash, `land` by rebase, `finish` always.
- Delegation reference (codex-subagent): a lane directory (`prompt.md` → `answer.md`, log, session, rc), a
  six-part brief, a fresh review lane by another vendor, acceptance by the orchestrator, at most three rounds,
  a baseline captured before a lane (kimi-delegation). Executors neither push nor delegate further.

### deck-server
Given SSH access:
1. Preflight.
2. Dokploy, plus an API key for itself (0600, `~/.config/dokploy/<host>.env`).
3. Through its API: Uptime Kuma, Beszel (hub + agent), Bugsink, VictoriaLogs, optionally Dotasker.
4. Read-only credentials for each.
5. Backups: the S3 keys are asked through a decision and private local entry. Database and volume backups for
   every app, and one restore proven.
6. Alerts to the client's topics.
7. Writes the profile's sources, so deck-support reads everything at once.

Every write first says "was → will be". The read helpers are today's `beszel.py`, `bugsink.py`, `dk.sh` and
`prod-logs`, with the address taken from env instead of being hardcoded.

## 2. Logs: VictoriaLogs fed by Dokploy's own Vector exporter

Both plans chose this independently.
- Dokploy's live viewer keeps nothing across a redeploy. Its "Logs & Metrics" exporter (Vector) ships container
  logs to an external store.
- VictoriaLogs:
  - keeps history, with retention 14–30 days;
  - is the lightest store compared;
  - takes the Loki push format;
  - is queried with one `curl` (LogsQL over HTTP), so any vendor's agent can read it;
  - goes behind Traefik basic auth.
- Rejected:
  - Dozzle: no history, a live UI for humans only (optional);
  - OpenObserve: an official template and built-in auth, but a heavier platform; it is the fallback;
  - Loki: more RAM, and in practice it wants Grafana;
  - Logdy: a live ring buffer.
- deck-support gets `logs.py query "<LogsQL>" --since 1h --limit 200` with the same masking as `prod-logs`.
- Spike first: does Dokploy's Loki target reach VictoriaLogs, and are worker nodes covered? If not, run our own
  Vector service with the `docker_logs` source.

## 3. Tracker: adapter, Dotasker by default

- Dotasker is not embedded. It is Django on the client's public domain with Telegram login, one per client,
  while DeckAway is stdlib-only, owner-facing and behind Tailscale.
- It is deployed by deck-server through the Dokploy API. `SETUP_AGENT_KEY_HASH` means the agent key is made
  locally and never reaches the server.
- `deck-support/scripts/tracker.py` verbs: `list`, `show`, `find --source`, `create` (idempotent by source),
  `source`, `comment`, `attach`, `update --status --assignee --index`, `close --result --check-url`, `claim`,
  `release`. Normalised statuses: `waiting`, `inbox`, `in_progress`, `done`.
- Kinds:
  - `dotasker` (built in);
  - `command` (the profile maps verbs to a project script: padel's board scripts, YouGile);
  - `mcp` (the profile names the MCP tool per verb and a `command` fallback for agents without that MCP).
- Claims live in the tracker (`in_progress` + comment), plus a lock file per tree. A gateway-wide claim service
  only if two computers start taking the same project's tasks.

## 4. Injection into every agent

Storage:
- The core skills ship inside DeckAway releases, generated into `integrations/skill_bundle.py` by the build
  (the updater accepts only `integrations/*.py`, so no new channel and no new trust path; a release is the
  version, and rollback is the updater's).
- Profiles live in the project repos.
- Running agents get the new version at their next start, and the daily restart guarantees that within a day.

Two layers; correctness depends only on the second:
1. Native skill folders: the core is copied into each installed agent's skills folder (`~/.claude/skills`,
   `~/.codex/skills` or the shared `~/.agents/skills`, Kimi's `extra_skill_dirs` in DeckAway's own
   `KIMI_CODE_HOME`, Gemini, Copilot and Qwen where their version reads one). A new `skills` field per entry in
   `integrations/agents.py` says where. Only folders with our marker file are written or removed.
2. A bootstrap note (~6 lines: "DeckAway skills vX: support / next-task / server; when a task matches, read
   `<path>/SKILL.md` first; project profile `.deckaway/`"), emitted by `skills.agent_note()` beside
   `decisions_note()`:
   - Claude Code, claude-kimi, claude-provider (GLM), Codex: the existing SessionStart hooks;
   - hookless agents (native Kimi, Windows Codex, Gemini, Cursor, OpenCode, Copilot, Qwen): queued once as the
     first prompt through Schedule (`idle`), with a tmux option so a resume never repeats it.
   - Never a managed block in users' own `GEMINI.md`/`AGENTS.md`: those are their files. A project that wants
     it permanently adds one line to its own `AGENTS.md`.

Settings → Agents gets a "check" per agent: its headless command is asked to name the `deck-` skills, and the
result is pass/fail with the version. This is the test matrix.

Loops must not depend on Claude's `/loop`: a Schedule entry gains `repeat` (seconds). It is re-armed after it
fires and skipped while the session has a question, a limit or typed text (those guards exist). A "Duty tick"
quick prompt then drives any agent.

## 5. Roles and models

- `integrations/roles.py`, with `~/.config/cc-panel/roles.json` per computer (sign-ins are per computer),
  edited in Settings → Agents through the gateway.
- An entry has: id, harness (`claude`, `codex`, `kimi`, `provider:<id>`, a CLI agent), model, roles
  (`orchestrator`, `executor`, `reviewer`, `triage`), order, `floor` (minimum % left), and a quota group (one
  account on several computers shares one).
- The lane command comes from `agents.py` (a new `lane` field beside `headless`). Provider and Kimi lanes go
  through `session_hook.py claude-provider|claude-kimi … -p`, so keys stay in the environment.
- Availability:
  - Claude, Codex, Kimi: `usage.py` windows;
  - others: "unknown", picked after the known-available ones;
  - a lane that hits a limit (`limits.detect` on its log) cools down until the reset, or an hour.
- `roles.py pick --role executor --n 5` prints one line per lane: id, exact command, headroom.
  `--role reviewer --not <author>` gives another vendor when there is one.
- The orchestrator is simply the session's own agent: delegation is shell commands, not vendor tools. When
  `pick` returns only itself, it works alone. The profile's allowed executors limit which vendors see a
  client's code.
- The bootstrap note replaces `leader_note`: one source of truth.
- Lanes stay headless at first. Visible lanes (a DeckAway session per tree, with spend and auto-continue) come
  later.

## 6. Phases (each shippable)

1. Skills only, no DeckAway code: write the three cores (deck-server without provisioning yet), and split
   1826, kozavita and padel into profiles. Run one duty tick and one next-task per project by hand.
2. `integrations/skill_bundle.py` + `skills.py`: native folders for the Claude kinds and Codex, the hook
   note, the version per computer in Settings (16 locales), `PACKAGES`.
3. Other agents: `skills`/`lane` in `agents.py`, the first-prompt path, the check action, Schedule `repeat`.
4. `roles.py`: registry UI, `pick`, cooldowns, `lane.py`; retire `leader_note`.
5. deck-server: VictoriaLogs spike, generalised readers, Dotasker recipe, backups with a proven restore.
6. Later: visible lanes; tracker counts on the board.

## Risks

- Writing into agents' folders on other people's machines → only marker-owned folders, never memory files.
- A skill is an instruction to every agent → it ships only in signed-off releases, and the version is shown
  per computer.
- Another vendor sees client code → the profile's allowed executors.
- Headless lanes are invisible to spend and auto-continue until visible lanes exist.
- The owner's Telegram reader (`my-telegram`, Telethon) is one machine's state: it stays a separately installed
  connector, never a panel dependency, so duty that reads it is pinned to that computer.

## Owner's decisions (2026-11-23)

1. The core skills ship to every DeckAway user: an advantage of the product.
2. Every vendor may see a client's code by default; a profile can restrict it (`executors`).
3. Autonomy is per project profile. The common default: ask before a push (and a deploy); a project may turn it off.
4. `.deckaway/` is committed into the client's repo.
5. Pilot: 1826, with VictoriaLogs on its server. The support skill asks for VictoriaLogs on every project
   ("логи нам прям нужны").

## Status

- Phases 1 and 2 shipped together in 1.92.0 (`skills/`, `integrations/skills.py`): cores for Claude Code and
  Codex; the 1826 profile is written by its duty session on the first run of deck-support.
