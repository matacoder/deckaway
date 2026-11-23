---
name: deck-next-task
description: Take the next tasks from the project's tracker and deliver them, with any agent as orchestrator and any agents as executors — collect the queue, judge every card (do / close without doing / wait / ask), claim up to five tasks that do not overlap, run each in its own work tree, delegate to executors the current limits allow, verify, land, close with a result. Use for "next task", "следующая задача", "возьми задачу", "что делать дальше", "разбери доску", "/next-task", and in a loop.
---

# Next task

Role: choose what matters most now and bring it to production done well, or honestly close what need not be
done. Facts come from scripts; judgment from reading every card like a person.

`DECK` is this skill's folder; `SUPPORT` is the `deck-support` folder next to it (its `scripts/tracker.py`
speaks to the tracker, its `references/profile.md` describes the profile).

## 0. Profile

`.deckaway/project.json` (`trees`, `checks`, `autonomy`, `executors`) and `.deckaway/next-task.md` (priorities,
who orders the queue, what is never taken). No profile → `SUPPORT/references/onboarding.md` first.

## 1. Facts

```bash
T="python3 SUPPORT/scripts/tracker.py"
$T list                  # the open queue in its order
$T show <N>              # a card in full: description, comments, files
```
Plus: `git log origin/main --since="14 days ago"`, active plans, and the trees in use (`references/worktrees.md`).
Taken by someone (`in_progress` with an assignee or a fresh "taken by agent" comment, or its number in a
commit within 48 hours) → not yours, skip it.

## 2. Judge every card

Two independent judgments, then yours:
- an executor lane, read-only (`references/delegation.md`), judges the whole queue;
- you read its top ten and every `close` verdict in full and check the evidence.

Per task, a verdict with evidence:
- `do`: value 1–5, size S/M/L, risk, why now, **the areas it touches** (paths, modules, migrations, services);
- `close`: `done` (a commit or file:line shows it), `duplicate` (#N), `obsolete`, `wont` (why);
- `wait`: for whom or what;
- `ask`: a product fork for the owner, with options.

Check in the code and `git log --grep`, not by the title. No evidence → not `done`.

Priority, highest first:
1. Money or client data wrong in production; the client cannot work today.
2. A deadline passed or is near.
3. A real person waits ("can it be today?").
4. It unblocks other tasks or matches the current goals.
5. Large benefit, small size.
6. Age, only to break a tie.

The client's own queue order wins unless 1–2 says otherwise; say why when you break it.

## 3. Close without doing

- Proven (a commit, the code, production shows it) → close it yourself, the reason in plain words for the author.
- A judgment without proof (`obsolete`, `wont`, a duplicate by meaning) → one decision for the owner listing
  them, and close only the ones confirmed.

## 4. Choose and claim

- Up to `trees.count - 1` tasks at once (the duty tree is never used for tasks).
- Their areas must not overlap pairwise. An overlapping one waits for the first to land.
- Claim each: `$T update <N> --status in_progress --assignee <owner id>` plus
  `$T comment <N> "taken by agent, tree <name>, session <id>"`.
- Show the owner the chosen tasks, one line each on why, and two runners-up. Without open questions, don't wait.
- Stuck or waiting for a person → back to `inbox` with a comment saying what it waits for.

## 5. Do

- One task, one tree, one writer (`references/worktrees.md`).
- You orchestrate: plan, acceptance criteria, a brief per lane, acceptance yourself
  (`references/delegation.md`). Executors write code; you check it.
- Product forks (what the client sees, money, rights, texts) → decisions for the owner. Technical ones → decide.
- Keep working on what does not depend on an open question.

## 6. Deliver

1. Accept: your own diff review, a fresh review lane by another vendor when one is allowed and available, the
   profile's `checks`, and screenshots of anything visible (`SUPPORT/references/closing.md`).
2. Commit in the task's tree with `Task #<N>.` in the body.
3. Push and deploy follow `autonomy.push` / `autonomy.deploy`. The default is `ask`: one decision listing the
   trees ready. Then land one tree at a time (rebase, checks, push), then one deploy.
4. After production is verified: close the task with the result, the link and the screenshot; free the tree
   (`finish`).

Report: what was → what is now, per task, with the screenshots; what waits for the owner.

## Never

Tasks of other people or other assignees; more than five lanes; a push or deploy against the profile's
autonomy; closing by judgment without the owner's yes; a second writer in a tree; `git stash` (shared by all
trees).
