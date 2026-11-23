# A fresh data copy for an answer

When an answer needs current data (what a client sees, a balance, an order), use the profile's `fresh_data`
command. It loads the latest production backup into an isolated local copy. Rules for writing one:

- Restore into the duty tree's own stand, never the main tree's and never production.
- Before the app starts on the copy: outgoing workers, mail, SMS, payment and Telegram senders are off.
  Otherwise a copy sends real messages to real clients.
- Read-only queries only. Answer with the data's cut-off time ("as of the 09:00 backup"), not the download time.
- Personal data from the copy stays out of tasks and replies.
- One refresh at a time per computer: a lock file. A refresh younger than the profile's limit (default 1 hour)
  is reused.
- No such command yet → say so in the report and propose one (a decision): backups already exist on the
  server (deck-server sets them up).
