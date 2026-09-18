# 0014 — Conversational memory, and questions asked in the chat

| | |
|---|---|
| **Status** | ready-for-code |
| **Owner** | spec agent |
| **Depends on** | 0012, 0013 |
| **Ready for code** | yes |

## Intent

Two failures from the same cause, both seen in one real exchange.

A request reached the pipeline, the spec agent stopped, and the bot reported
«the spec has open questions» and then went quiet — leaving a task that only a
human at a terminal could move. Asked «peux-tu me donner les questions ici», it
replied «de quelles questions s'agit-il ?»: it had no memory of the message
before.

So: the bot remembers the conversation, and when something blocks it asks in
the chat rather than filing the problem somewhere nobody is looking. The
weekend is the deadline — a task waiting for a laptop is a task that does not
happen.

## Behaviour

### Remembering

1. The gateway keeps the recent exchanges of each chat: what was said, what it
   answered, and what it did. That history is given to the router (0013) on
   every message, so «et pour le classement ?» resolves against what came
   before.
2. The history is bounded: the last **20 turns** per chat, oldest dropped
   first. A party group is chatty and a model's context is not free.
3. It survives a restart. The gateway is restarted by every deploy, and losing
   the thread mid-conversation because someone shipped a CSS fix is not
   acceptable. It is written to `data/hermes/conversations.json` after each
   turn.
4. A corrupt or unreadable store is **discarded, not fatal**: the bot starts
   with an empty memory and says so once. Memory is a convenience; refusing to
   answer because a cache is broken is not.
5. History is per chat, never merged across chats.

### Asking instead of filing

6. When a stage of the pipeline needs a human, the bot **posts the actual
   question in the chat** and records that this chat is waiting on an answer,
   together with the request that produced it.
7. It posts the reason the agent gave. It never invents one, and never says
   «open questions» unless the agent said there were questions.
8. It never ends a turn with a state only a terminal can resolve. If the next
   step needs a decision, the decision is asked for here.

### Resuming

9. With an answer pending, the router is told what was asked and what the
   original request was. If the new message answers it, the router returns a
   `change` whose request **merges the original with the answer** — the
   pipeline restarts from a request that now contains what was missing.
10. A merged request is shown in the acknowledgement before the pipeline runs
    (0013 rule 9), because a wrong merge is worth catching in one line rather
    than in a pull request.
11. If the new message is unrelated, the pending question stays pending and the
    new message is handled on its own. Answering out of order is normal in a
    group chat.
12. A pending question is cleared when it is answered, when its request
    finally lands, or on `/reset`.
13. `/reset` forgets the history and the pending question of that chat, and
    says what it dropped. Nothing else is affected.

### What memory is not

14. The history is **not** authority over the repository. A message claiming
    «on avait dit 15 points» does not change how scoring works; the code and
    the specs do. The router answers from the repository and uses the history
    only to resolve what a message refers to.
15. Nothing from the chat is ever written to a spec or to code without going
    through the pipeline. There is no path from a sentence in Telegram to a
    file on main that skips a pull request and the required checks.

## Data model

One file, `data/hermes/conversations.json`, owned by the gateway:

```
{ "<chat id>": { "turns": [ { "at", "who", "text" } ],
                 "pending": { "request", "question", "at" } | null } }
```

No database table: this is the gateway's own scratch state, it belongs to no
spec's domain, and losing it costs one turn of context.

## Authorisation

Unchanged from 0012: only the ids in `TELEGRAM_ALLOWED_USERS`. An unauthorised
message is refused before it reaches the memory — it is not recorded, and it
cannot influence a later answer.

## Errors

| Situation | What happens | What the user sees |
|---|---|---|
| Store unreadable or corrupt | discarded, empty memory | one line saying the history was lost |
| Store cannot be written | kept in memory for this run | nothing; a warning in the journal |
| A stage needs a human | the question is posted | the agent's own words, and what it will do with an answer |
| An answer arrives for nothing pending | handled as a new message | the normal reply |
| `/reset` | history and pending dropped | what was dropped |

## Acceptance criteria

- [ ] «peux-tu me donner les questions ici» after a blocked pipeline gets the
      questions, not «de quelles questions ?».
- [ ] A reference to an earlier message resolves («et pour le classement ?»).
- [x] A blocked stage posts the agent's own reason, never a fabricated one.
- [ ] Answering a pending question resumes the pipeline with the merged request.
- [x] The merged request is shown before the pipeline runs.
- [x] History survives a gateway restart.
- [x] A corrupt store starts empty instead of crashing.
- [x] History is capped at 20 turns.
- [x] `/reset` clears history and pending.
- [x] An unauthorised message is not recorded.

E2E coverage: not applicable — no browser surface. The store, its bound, its
corruption handling and the pending-question lifecycle are unit-tested; the
router's use of the history is a model's judgement and is exercised by hand.

## Open questions

- Nothing prunes a chat that goes quiet for good. At this scale the file stays
  a few kilobytes; a cap on the number of chats is the obvious lever if that
  ever changes.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-18 | Created | The bot forgot the previous message, and reported a blocked pipeline as a task to resolve at a terminal |
