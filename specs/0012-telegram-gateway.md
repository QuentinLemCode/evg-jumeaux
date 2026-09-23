# 0012 — Telegram gateway

| | |
|---|---|
| **Status** | ready-for-code |
| **Owner** | spec agent |
| **Depends on** | 0011 |
| **Ready for code** | yes |

## Intent

The pipeline works from a shell and nowhere else. During a weekend away, the
person who can fix the leaderboard is holding a phone, not a laptop with a
tailnet session — so "ask for a change from the group chat" is the difference
between a fix happening and it waiting until Monday.

`hermes-gateway.service` has always pointed at `/home/hermes/.local/bin/hermes`,
a binary this repository never shipped and nothing installed. The unit was
enabled and dead, which reads as running: tagging the bot produced silence with
no error anywhere. This spec replaces the missing program with one that is in
the repository, tested, and deployed with everything else.

This is the **transport**: it carries commands and requests, and reports back.
A conversational layer on top of it is a separate spec — the fiddly parts
(mention gating, authorisation, jobs that outlive a request, progress on a
phone) belong here and are shared by both.

## Behaviour

### Triggering

1. The gateway reacts **only when the bot is explicitly mentioned** — in every
   chat type, private included. An unmentioned message in the group is ignored
   without a reply and without a log line above debug.
2. A mention is `@the_bot_username` as a Telegram `mention` entity, or a
   `text_mention` entity pointing at the bot's own id. A bare string that looks
   like the username but is not an entity does not count: Telegram tells us
   where the mentions are, and trusting the text instead is how a quoted
   message triggers a deploy.
3. The mention is stripped before the rest is interpreted, wherever it sits in
   the message. `@bot /status` and `/status @bot` behave identically.
4. A message with a mention and nothing else is treated as `/help`.

### Authorisation

5. Only Telegram user ids listed in `TELEGRAM_ALLOWED_USERS` may do anything.
   It holds the admins' ids — the two `admin` players of 0002 — and nobody
   else.
6. An unauthorised mention gets one reply saying it is not authorised, and the
   attempt is logged with the id so an id can be added deliberately. It is not
   ignored silently: a guest who tags the bot deserves to know it heard them.
7. `TELEGRAM_ALLOWED_USERS` empty means **nobody is authorised**, not everybody.
   The gateway says so at startup and keeps running: a misconfigured allowlist
   must never be an open door.

### What it can be asked

8. Four commands, each a script from `scripts/agent/`. `/deploy` was a fifth
   and was removed by [0016](0016-read-only-bot.md): deploying is a write.

   | Command | Runs | Answers with |
   |---|---|---|
   | `/status` | `status.sh` | the app's health, the services, open PRs |
   | `/errors` | `app-exec.sh client-errors` | open browser-error groups |
   | `/logs` | `app-exec.sh logs` | the last lines from the app VM |
   | `/help` | — | the list above, and what the bot can be asked |

9. Anything else goes to the router of **spec 0013**, amended by
   [0016](0016-read-only-bot.md): it decides between answering, turning a bug
   report into a prompt, and asking one question back. It starts nothing.
   What follows described the pipeline it used to start, and is kept as the
   record of why that was removed — that is the point
   of the gateway, «ajoute un mur de photos» has to reach the same loop a human
   would run. *(Superseded: this rule originally treated every non-command
   message as a change request, so asking a question launched the spec agent.)*
10. One job at a time, tailnet-wide. A second request while one is running is
    refused with what is running and since when, not queued: two concurrent
    `pipeline.sh` runs would fight over the same checkout.

### Reporting back

11. Every accepted message is acknowledged within a second, before the work
    starts. A phone with no reply is indistinguishable from a broken bot.
12. A job that outlives its acknowledgement reports progress by **editing that
    same message**, so a five-minute pipeline is one message that changes
    rather than nine notifications.
13. The final reply carries the outcome and, for a pipeline run, the PR URL.
14. Output is truncated to Telegram's 4096-character limit at a line boundary,
    with the last lines kept: the end of a failing log is the useful part.
15. A crash in the gateway is reported to the chat and the process exits
    non-zero, so systemd restarts it. Silence is the one failure mode this
    whole spec exists to remove.

### Delivery

16. It runs from the repository checkout on the agents VM as
    `npm run hermes:gateway`, under the existing `hermes-gateway` unit.
17. Long polling, not webhooks: the agents VM has no inbound port, by design
    (see `docs/deployment.md`). A webhook would require one.
18. The bot token comes from `TELEGRAM_BOT_TOKEN` in `~/.hermes/.env`, which
    Terraform already writes. No new secret.

## Data model

None. The gateway holds its state in memory — the running job and the polling
offset — and owns no table. A restart loses the offset, which Telegram
tolerates: it replays recent updates, and rule 10's lock stops a replayed
request from starting a second job.

## Authorisation

| Operation | Who |
|---|---|
| `/status`, `/errors`, `/logs`, `/help` | ids in `TELEGRAM_ALLOWED_USERS` |
| `/deploy` | ids in `TELEGRAM_ALLOWED_USERS` |
| a change request | ids in `TELEGRAM_ALLOWED_USERS` |
| anything at all, from any other id | refused with one reply |

There is no read-only tier. Everyone on the allowlist is an admin of the party;
splitting the two would be a distinction without a difference here.

## Errors

| Situation | What happens | What the user sees |
|---|---|---|
| Mention from an unlisted id | refused, logged with the id | "Tu n'es pas autorisé à piloter le pipeline." |
| `TELEGRAM_ALLOWED_USERS` empty | every request refused | the same, and a warning in the journal at startup |
| A job already running | refused, not queued | what is running, and for how long |
| A script exits non-zero | reported with its output | the tail of the output, truncated at a line |
| Telegram API unreachable | retried with backoff | nothing; the poll resumes |
| `TELEGRAM_BOT_TOKEN` missing | exits non-zero at startup | nothing — there is no chat to answer in |

## Acceptance criteria

- [x] An unmentioned message in a group produces no reply.
- [x] `@bot` with nothing else replies with the help text.
- [x] A mention anywhere in the message works, and is stripped.
- [x] A string that looks like the username but is not a Telegram entity does
      not trigger anything.
- [x] An id absent from `TELEGRAM_ALLOWED_USERS` is refused, once, with a reply.
- [x] An empty `TELEGRAM_ALLOWED_USERS` refuses everyone.
- [ ] `/status` answers with the report from `status.sh`. *(needs a live bot)*
- [ ] Free text runs `pipeline.sh` and the final reply carries the PR URL.
      *(needs a live bot)*
- [x] A second request during a run is refused naming the running job.
- [x] A reply longer than 4096 characters is cut at a line boundary, keeping
      the end.
- [ ] The acknowledgement arrives before the job finishes, and the same message
      is edited rather than replaced. *(needs a live bot)*

E2E coverage: not applicable — the gateway has no browser surface. Its pure
logic (mention parsing, authorisation, routing, truncation) is unit-tested, and
its shell bridge is the same one `scripts/agent/` exposes and that spec 0011
already exercises.

## Open questions

- A conversational layer (Gemini 3.8 flash driving `hermes/tools.json`) sits on
  top of this transport and is deliberately out of scope. It needs its own spec,
  and its cost per message is a decision for the operator, not a default.
- Discord is wired in the environment but not implemented here. The same
  transport shape applies; nobody has asked for it yet.

## Changelog

- **2026-09-23** — Amended by [0016](0016-read-only-bot.md): `/deploy` removed,
  and free text no longer starts a pipeline. The gateway became read-only.

| Date | Change | Why |
|---|---|---|
| 2026-09-18 | Created | The gateway binary never existed; tagging the bot produced silence |
| 2026-09-18 | Rule 9 defers to spec 0013 | Treating every message as a change request meant a question launched the spec agent |
