# Closing a task and telling the chat

Every `done` carries:
1. **Result**: what was done, in 1–3 plain sentences for the client, not a commit log.
2. **Where to check**: `--check-url` with the exact page; no URL (a decision, a document) → the result says
   where to find it.
3. **Screenshot**: a headless screenshot of the live result, attached before closing.
   - Desktop 1440 px wide, and 390 px when people use it on phones.
   - Saved to `screenshots/<slug>-<date>/` in the main tree (or the scratch folder when it shows personal data,
     masked).
   - Claim only what the screenshot shows. No screenshot possible (access, a call) → the result says why.
4. **Assignee**: whoever did the work (the owner's id when it was the owner or an agent).

Then, when the request came from a chat, reply on that message with the result, the link and the screenshot.
A tracker that posts the result to the chat by itself (Dotasker on `done`) needs no second message.
