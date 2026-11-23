# Giving work to agents

Any harness can orchestrate; any can execute. The orchestrator (this session) plans, briefs, accepts, lands
and reports. Executors write code, run checks, investigate, review. When no executor is available, the
orchestrator does the work itself.

## Who may execute

- The profile's `executors`: `"all"` (default) or a list of harnesses allowed to see this client's code.
- What is installed and signed in: DeckAway's note lists the agents on this computer and how to run them
  headless.
- What the limits allow: an executor near its limit (DeckAway shows the remaining percentage under the message
  field, `claude /usage`, `codex /status`) is skipped; one that stops with a limit notice rests until its reset.
- Prefer a different vendor for review than the one that wrote the code.

## A lane

One lane = one folder in the scratch space, `<scratch>/lanes/<slug>/`, holding `prompt.md` (the brief),
`answer.md` (the final message), `log`, `session` (to continue the same conversation) and `rc`.
Run it in the background; you are told when it ends. Do not poll.

| Harness | Write (in its tree) | Read-only | Continue |
|---|---|---|---|
| Codex | `codex exec -C <tree> -s workspace-write -o answer.md - < prompt.md` | `-s read-only` | `codex exec resume <session> -` |
| Claude Code | `claude -p --permission-mode acceptEdits < prompt.md` in the tree | `--permission-mode plan` | `claude -p --resume <session>` |
| Kimi, GLM (through Claude Code) | as DeckAway's note says (`session_hook.py claude-kimi` / `claude-provider` … `-p`): keys stay in the environment | | |
| Other CLIs | their headless form from DeckAway's note | | |

Feed the prompt on stdin (an open stdin hangs some CLIs). Never pass bypass or "yolo" flags unless the owner
agreed for that tree. A sandboxed executor may lack Docker or network: it writes tests blind, and you run them
in the tree's stand during acceptance.

At most five lanes at once, triage and review lanes included. Queue the rest.

## The brief (`prompt.md`)

The executor sees only the brief and the repo:
1. **Goal**: what must be true when done, in one or two sentences.
2. **Context**: files and docs to read first (AGENTS.md, README, the plan), what is known or ruled out.
3. **Scope**: what to touch and what not; the project's code rules.
4. **Acceptance**: commands that must pass, behaviour to show, tests to add.
5. **Prohibitions**: no commits, pushes, deploys, production writes, printed secrets, `git stash`, other
   trees, review-record scripts, git config or hooks, sending code to other services or models, delegating
   further.
6. **Report**: files changed, how it was verified (commands and results), what is left or doubtful. Ask for
   honesty about failures.

Before a lane edits a tree, note its state (`git status --short`, `git rev-parse HEAD`), so its changes are
told apart from earlier ones.

## Acceptance

Read `answer.md`, then the diff yourself. Run the checks. A fresh read-only review lane on the diff (another
vendor when one is allowed). Failures go back to the same lane with the exact output (`resume`). At most three
rounds; then do it yourself or ask the owner. Check which model actually ran (the log), not which one was
asked for.
