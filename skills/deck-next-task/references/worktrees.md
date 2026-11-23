# Work trees: a fixed pool

Shared by all trees: `.git` (branches, stash, refs), Docker, host ports, memory. Separate: files, branch, stand.

## Pool

- `trees.count` permanent trees named `<prefix><n>` (default `w1`..`w6`): 1..count-1 take tasks, the last one
  is the duty tree. All task trees busy = a queue, never an extra tree.
- The name is everything: `w2` is `.claude/worktrees/w2`, branch `worktree-w2`, Compose project
  `<project>-w2`, its own ports (`base + 10 × n`).
- Free = nothing outside `origin/main` by content (`git cherry -v origin/main HEAD`: `-` lines are landed under
  another hash) and nothing uncommitted. Zero containers does not mean free.
- Trees are never removed: their database and images stay for the next task. Never remove the tree your own
  session started in.

## Cycle

The profile's `trees.commands` when the project has them; otherwise plain git:

```bash
git fetch origin
git worktree add .claude/worktrees/w2 -B worktree-w2 origin/main      # first use only
git -C .claude/worktrees/w2 reset --hard origin/main                  # take: only when it is free
# … work, commit in the tree …
git -C .claude/worktrees/w2 rebase origin/main                        # land: then the checks
git -C .claude/worktrees/w2 push origin HEAD:main                     # only as autonomy.push allows
```
Finish, always, also for abandoned work: unfinished work is committed to `park/<topic>` first, the stand is
stopped (its data kept), the tree is put back at `origin/main`. Screenshots and reports move to the main
tree's folders before that.

## Shared = untouchable

- No `git stash`: one stack for all trees. Park work as a commit.
- The main tree stays on `main`; never commit, reset or `add -A` there while another session works in it.
- Other trees and stands are read-only for you. Never `docker system prune` or remove containers you did not
  start.
- One writer per tree: parallel lanes that edit files get separate trees. Read-only lanes may share one.
- Memory is shared: a full test run can kill a neighbour's (exit 137). Stop the stands you do not use.

## Clean all trees (only on the owner's request)

Per tree: what is unlanded (`git cherry`), uncommitted, or running (`lsof -d cwd | grep worktrees/<tree>`).
Real unlanded work gets a `backup/<tree>-<date>` branch first. A tree in use is left alone. Report per tree:
was → now, and where any copy lies.
