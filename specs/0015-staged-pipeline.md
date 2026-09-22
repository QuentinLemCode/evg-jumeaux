# 0015 — A staged pipeline the chat can follow

| | |
|---|---|
| Status | Implemented |
| Depends on | [0012](0012-telegram-gateway.md), [0013](0013-natural-language-routing.md), [0014](0014-conversational-memory.md) |

## Intent

Today a change request goes into `pipeline.sh` and nothing is heard until it
is over. The spec agent writes a specification, the code agent implements it
and a pull request appears — and the human who asked never saw the
specification that decided what was built.

Two things follow, and both were observed:

1. **No visible progress.** A run takes minutes. A phone showing one
   unchanging message is indistinguishable from a bot that has crashed, so the
   human asks again, and the second request is refused for a lock they cannot
   see.
2. **No say over the specification.** `specs/` is the contract this project is
   built on, and it was being written and acted upon in one breath. The one
   moment where a misunderstanding is cheap to correct — before any code
   exists — was being skipped.

So: the pipeline runs in **stages**, each stage is **posted as it happens**,
and the run **stops after the specification** until a human approves it.

## Behaviour

### Stages

A change request runs as two phases with a human between them:

```
  specification  ─▸  [ the human approves ]  ─▸  code ▸ review ▸ pull request
```

1. **Rule 1.** `pipeline.sh --spec-only "<request>"` runs step 0 and the spec
   agent, then stops and reports `SPEC_FILE`.
2. **Rule 2.** `pipeline.sh --from-spec <spec-file>` runs the code agent, the
   review and the pull request, with no spec agent.
3. **Rule 3.** The existing one-shot form keeps working unchanged. It is what
   a human at a terminal wants, and removing it to serve the chat would be a
   regression for the other caller.

### Progress in the chat

4. **Rule 4.** Every script that takes more than a few seconds prints its
   stages as `STEP <n>/<total> — <label>`. That line is the contract between
   the scripts and the gateway; the gateway parses nothing else from the
   stream.
5. **Rule 5.** The gateway keeps **one** message per request and edits it, as
   0012 rule 12 requires. It renders the stages as a list: done stages
   ticked, the current one marked as running, the rest pending.
6. **Rule 6.** The list is rendered with emoji — `✅` done, `⏳` running,
   `⬜` pending, `❌` failed. No stage is ever removed from the list once
   shown, so the human sees where it stopped.
7. **Rule 7.** **No terminal escape sequence ever reaches the chat.** The
   scripts stop colouring when their output is not a terminal, and the gateway
   strips any escape it is nevertheless given. A message reading like
   `ESC[36m[18:29]` is a defect, not cosmetics: it is the bot proving it does
   not know who it is talking to.

### The approval gate

8. **Rule 8.** When the spec stage succeeds, the bot posts, in French: the
   spec's path, its summary, and its acceptance criteria. Then it asks for
   approval in one line and waits. Nothing is coded yet.
9. **Rule 9.** Approval is a reply that is **only** an affirmative — `oui`,
   `ok`, `go`, `valide`, `c'est bon`, `lance`, `vas-y`, `👍` and the obvious
   variants, case- and accent-insensitive, punctuation ignored. Recognising it
   costs no model call.
10. **Rule 10.** Any other reply is a **revision**: the bot re-runs the spec
    agent with the original request and the reply merged, and asks again. A
    human correcting the spec must never have to repeat the whole request.
11. **Rule 11.** A pending approval is remembered exactly like a pending
    question (0014 rule 6), survives a restart, and is cleared by `/reset`.
12. **Rule 12.** An approval with nothing pending is answered plainly. `oui`
    on its own must never start a pipeline.

### Failure

13. **Rule 13.** A stage that fails leaves its list entry marked `❌`, and the
    reason posted underneath comes from the agent, never from the gateway
    (0014 rule 7).
14. **Rule 14.** A spec stage that stops with open questions is a question in
    the chat, as today. Answering it restarts the spec stage, not the whole
    pipeline.

## Data model

`Pending` gains a discriminator. `kind: 'question'` is what 0014 describes;
`kind: 'approval'` additionally carries the `spec` file the approval would
release. A store written before this change parses as `kind: 'question'`,
because that is what every pending entry in it was.

## Authorisation

Unchanged from 0012: the allowlist decides, and an approval is a message like
any other. A guest who is not on the allowlist cannot approve a spec.

## Errors

| Situation | What the human sees |
|---|---|
| Spec agent fails | The stage marked `❌` and the agent's own reason |
| Spec written, waiting | The spec, its criteria, and the request to approve |
| Approval with nothing pending | «Il n'y a rien à valider pour l'instant.» |
| Revision | The spec stage runs again, and the new spec is presented |
| Code stage fails after approval | The stage marked `❌`, the agent's reason, and the spec path so it can be retried |

## Acceptance criteria

- [ ] `pipeline.sh --spec-only` runs the spec agent and stops before the code
      agent, reporting `SPEC_FILE`.
- [ ] `pipeline.sh --from-spec <file>` runs the code agent without re-running
      the spec agent.
- [ ] `pipeline.sh "<request>"` with no flag still runs end to end.
- [x] Every `STEP n/total — label` line emitted by the scripts is parsed into
      a stage, and an output with no such line yields no stage rather than an
      error.
- [x] The chat message shows one line per stage with `✅`, `⏳`, `⬜` or `❌`.
- [x] Given a coloured stream as input, nothing the gateway sends contains an
      ANSI escape sequence.
- [x] `scripts/agent/lib.sh` emits no colour when stderr is not a terminal.
- [ ] After a successful spec stage the bot posts the spec path, summary and
      criteria, and runs no code agent.
- [x] `oui`, `OK !`, `c'est bon`, `👍` are recognised as approval; `oui mais
      ajoute X`, `okay donc`, `non` are not.
- [ ] An approval with a pending approval starts the code stage on the
      remembered spec file.
- [x] An approval with nothing pending starts nothing and says so.
- [ ] A non-approval reply re-runs the spec agent with the original request
      and the reply merged.
- [x] A pending approval survives a gateway restart and is cleared by
      `/reset`.

E2E coverage: not applicable — no browser surface. The gateway is a Telegram
client and a process runner; its pure parts (stage parsing, escape stripping,
approval recognition, the pending store) are unit-tested, and the scripts are
exercised by the pipeline itself.

## Open questions

**The unticked criteria are implemented but not yet exercised end to end.**
Every one of them needs a real agent run, and the agents VM cannot reach a
model today: its API key is restricted to `aiplatform.googleapis.com` while
`agy` calls `generativelanguage.googleapis.com`. Ticking them from a reading
of the code would be a claim, not a check. They are:

- the three `pipeline.sh` modes actually running their agents,
- the bot presenting a specification after a real spec stage,
- an approval starting the code stage on the remembered spec,
- a non-approval reply re-running the spec agent with the merged request.

The first request that reaches the model exercises all four at once.

## Changelog

- **2026-09-22** — Created. Splits the pipeline at the specification, posts
  stage progress in the chat, and removes terminal escapes from what the bot
  sends.
