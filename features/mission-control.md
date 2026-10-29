# Mission control: every agent at a glance

The owner keeps jumping between sessions and computers to see who is working, who asks, who has finished.
The page shows one session at a time; the sidebar shows names and dots. Wanted: one view with all agents as
tiles, grouped by project or computer, arranged by hand.

Researched independently by Claude and Codex; both arrived at the same core, differences resolved below.
Phase 1 shipped in 1.72.0: the board, three groupings, "waiting for you", pins, in-tile questions and replies,
screen digests by Codex Sol. Phase 2 in 1.73.0: drag to reorder within a group (handle, pointer events,
arrow keys), tile sizes S/M/L; the pin became the start of the dragged order. Next: the open questions below.

## Shape
- A second view, "Пульт", next to the session view (header toggle, a hotkey on desktop). The session view
  stays as it is: the board is for overview and short replies, deep work stays in the focused session.
- Desktop: a grid of tiles (about three columns, denser on wide screens). Phone: one column of cards,
  questions first, groups collapsible; no drag or resize gestures on touch (they fight the edge drawers).
- An attention row on top: questions, then unread finished work, then unreachable computers. The grid
  below is stable: tiles never reshuffle by themselves, and nothing moves while someone types.

## A tile
- Title (owner's or auto title), agent icon, computer and project.
- One explicit state: asks / working / finished unread / idle / stopped; an unreachable computer is shown
  separately (its tiles greyed, last known content kept).
- The summary's `done` or short line with its age; context bar where the agent supports it.
- For agents without a summary (shell, Pi, Kimi Code, CLI agents): the last few lines of the screen as text.
- A question is answered right in the tile (the inbox question card, reused, with its drafts).
- Reply: one inline field bound to that tile's computer + session (+ creation time), keeping drafts.
- Open: the full session view for it, with an obvious way back to the board.

## Grouping
- One selector: by project, by computer, none. Default by project, with the computer as a badge on the
  tile; inside a group, the owner's order, otherwise most recent activity first.
- Same-named folders on different computers are only grouped together by name, never treated as one
  repository (no identity claim, no shared actions across them).
- Two-level nesting (project -> computer -> tiles) only if one level proves too flat in real use.

## Arrangement
- Phase 1: pin a tile to the top of its group.
- Phase 2: drag to reorder within a group (plus keyboard move for accessibility), tile size S/M/L.
  No free-form canvas, no pixel resizing.
- Kept per browser in localStorage, scoped to the gateway installation; a tile is keyed by computer id +
  session name + creation time, so a recreated session with the same name starts fresh. Content
  (summaries, screen text) is never part of the stored layout.

## Live terminals
- Not in tiles. Each ttyd frame is a real tmux client, and with `aggressive-resize` a small tile would
  resize the agent's own window and reflow its screen; ten websockets per board is also needless.
- One live terminal at a time: opening a tile. A side-by-side pair is a possible later step, if asked for.

## Data
- A new per-computer read, `/api/board`: the session list plus, per session, the cached summary line
  (read only, never starting a rewrite), context size, whether it has an open question, and a short
  screen tail (a capture of the last ~15 lines, not the 2000-line preview) only for agents without a
  summary. Revision per tile so unchanged tiles cost nothing.
- Polled per computer through the existing `instancePath` proxy, only while the board is visible:
  current computer every few seconds, others every 10 s, like the sidebar today (the board replaces those
  requests while open, it does not add a second loop). Questions keep coming from `/api/inbox`.
- Actions on another computer go through the same proxy (`send`, question answer); the board never calls
  `switchDeck` until the owner opens a session.
- An older computer without `/api/board` gets tiles from `/api/sessions` alone (title, state, folder).

## Screen digests (owner's call)
- One line about what the screen shows right now, by Codex Sol on the session's own computer, for every
  agent and plain terminals; the summary describes the conversation, the digest the current moment.
- The only place screen text goes to a provider other than the session's own, so it is a switch in
  Settings -> General, off by default, stored on the gateway; the page asks each computer for digests.
- Written only while the board is open, when the screen changed, at most every 3 minutes per session,
  two at a time; kept in memory (a restart costs one rewrite per session).

## Not now
- Wall of live terminals, free-form widget canvas, multiple saved layouts, layout synced across devices
  on the server, AI-made project grouping, sending one prompt to many sessions (later, idle sessions only,
  reviewed per target, never retried on an ambiguous send).

## Open questions for the owner
- How many sessions are typically alive at once (10? 30?) — decides tile density and the default size.
- Do same-named folders on different computers really mean the same project for you?
- Board as the start page on desktop, or only on request?
