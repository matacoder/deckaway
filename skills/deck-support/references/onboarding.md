# Putting a project on support

Goal: a `.deckaway/` profile in one sitting, then the first tick.

1. **What exists.** Read the repo's `AGENTS.md`/`CLAUDE.md`/`README.md`, `.env.example`, any older duty or
   support skill in `.claude/skills`, `.agents/skills`, `.codex/skills`. An older project skill is the best
   source: move its project facts (chat ids, topics, tracker commands, alert rules, the owner's dated
   instructions) into the profile, word for word for the instructions.
2. **Ask the owner once**, as one decision with everything still unknown:
   - where people write (chats, topics, staff who message the owner directly);
   - the tracker (Dotasker by default: its URL and an agent key in `.env`; or another one with an API or MCP);
   - the servers (Dokploy address, a read-only key), monitoring (Uptime Kuma, Beszel, Bugsink), logs;
   - who replies (a bot) and the autonomy wanted (defaults: replies yes, push/deploy ask first).
3. **No tracker yet** → offer Dotasker on the project's server (`deck-server`, "Dotasker" step).
4. **No logs** → offer VictoriaLogs (`deck-server`, "Logs").
5. **Write** `.deckaway/project.json` and `.deckaway/support.md` (`profile.md`). Commit them only when the
   profile's or the owner's push rule allows; otherwise leave them for the owner and say so.
6. **Older project skill**: once the profile holds its facts, propose (a decision) to delete it, so one skill
   does the duty.
7. **First tick** with the last 24 hours of each source, then the report.
