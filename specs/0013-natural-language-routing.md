# 0013 — Natural-language routing

| | |
|---|---|
| **Status** | ready-for-code |
| **Owner** | spec agent |
| **Depends on** | 0012 |
| **Ready for code** | yes |

## Intent

Spec 0012 gave the bot a transport and one crude rule: anything that is not a
slash command is a change request. So «comment le score est calculé ?» launched
the spec agent, which would either write a specification for a question or stop
and say the request was ambiguous. Asking about the app and asking to change it
were the same gesture, and only one of them worked.

This makes the bot read the message and decide. A question gets an answer. A
change request gets the pipeline. Anything it cannot place gets a question back,
because guessing wrong in the direction of "change" costs a pointless branch,
a pull request and five minutes.

Commands keep working. They are the shortcut, not the interface.

## Behaviour

### Deciding

1. A mentioned message that is not a slash command goes to a **router**, a
   read-only agent that answers exactly one of three ways:

   | Decision | Meaning | What happens |
   |---|---|---|
   | `answer` | the message asks about the app as it is | the answer is posted, nothing is written |
   | `change` | the message asks for the app to behave differently | `pipeline.sh` runs with the request |
   | `fix` | something in the project's own machinery is broken | `fix.sh` repairs it and opens a pull request a human must approve |
   | `unclear` | it could be either, or the request is too vague to specify | the bot replies with the one question that would settle it |

2. The router is **read-only**. It may read the repository — specs, code,
   AGENTS.md — and may not write a file, run a command that changes anything,
   or open a pull request. A question must never have side effects.
3. It errs towards `unclear`, never towards `change`. A misread question that
   becomes a change request costs a branch, a pull request and minutes of
   agent time; a misread change request that becomes a clarifying question
   costs one message.
4. «Corrige l'UI» is `unclear`, not `change`: it names no screen and no
   symptom, and the spec agent is required to stop on exactly that (0012, and
   AGENTS.md §7). Stopping one step earlier, in the chat, is cheaper and
   clearer.
5. A question about something the repository does not settle is answered with
   what is known and what is not. Inventing behaviour is worse than saying so.

### Answering

6. An answer cites where it comes from — a spec number, a file — so it can be
   checked. «Les points viennent de `scoring.ts`» is verifiable; «je crois que
   c'est 10 points» is not.
7. Answers are in French, like everything the guests see.
8. An answer is one Telegram message, truncated per 0012 rule 14.

### Repairing

11b. `fix` is for the machinery, not the product: an agent that crashes, a
    workflow that fails, a service that will not start. These get no numbered
    spec — `specs/` is the product contract — and run `scripts/agent/fix.sh`.
11c. The line between `change` and `fix` is whether the leaderboard behaves
    differently afterwards. «les marges sont fausses» is a change; «l'agent de
    specs plante» is a fix.
11d. A `fix` pull request touching infrastructure, workflows or agent tooling
    **cannot merge until a human adds the `infra-ok` label**, enforced by the
    `Guarded paths` check. Those files decide what the agent is allowed to do;
    an agent able to merge changes to them could weaken the gate that is about
    to judge its own pull request, and auto-merge would honour the weakened
    one.
11e. The agent may therefore propose any repair and merge none of them
    unattended. That is the whole of its new authority.

### Changing

9. On `change`, the bot posts what it understood **before** starting, in one
   line, then runs the pipeline exactly as 0012 rule 9 already does. The
   acknowledgement is the last chance to notice a misreading.
10. The router may rewrite the request into something a spec agent can act on —
    keeping the intent, adding nothing. It passes that rewrite to the pipeline
    and shows it in the acknowledgement.
11. The one-job-at-a-time lock of 0012 rule 10 applies unchanged. Routing is
    not a job: two people can ask questions while a pipeline runs.

### Failure

12. If the router fails or returns something unparseable, the bot says so and
    does **nothing else**. It does not fall back to running the pipeline: the
    failure mode of "we could not tell what you meant, so we changed the app"
    is not acceptable.
13. A router that takes longer than two minutes is abandoned, with a message
    saying so.

## Data model

None. The router holds no state and owns no table. It is given one message and
returns one decision.

## Authorisation

Unchanged from 0012: only the ids in `TELEGRAM_ALLOWED_USERS`, for everything.
Routing happens after the authorisation check, never before — an unauthorised
message must not cost an agent call.

## Errors

| Situation | What happens | What the user sees |
|---|---|---|
| Router cannot decide | replies `unclear` | the single question that would settle it |
| Router fails or times out | nothing is run | "je n'ai pas réussi à interpréter ta demande" + the error |
| Router returns an unknown decision | treated as a failure | the same, never a pipeline run |
| A question while a pipeline runs | answered normally | the answer |
| A change while a pipeline runs | refused by the 0012 lock | what is running, and for how long |

## Acceptance criteria

- [x] «comment le score est calculé ?» is answered, and no branch is created.
- [x] «corrige les marges du classement sur iPhone SE» runs the pipeline.
- [x] «corrige l'UI» comes back as a question, not a pipeline run.
- [x] The answer to a factual question names a spec or a file.
- [x] A router failure runs nothing at all.
- [x] An unparseable decision runs nothing at all.
- [ ] A question is answered while a pipeline is running.
- [x] Slash commands still bypass the router entirely.
- [x] The acknowledgement for a `change` shows the request that will be used.

E2E coverage: not applicable — no browser surface. The parsing of the router's
report, the three decisions and the failure handling are unit-tested; the
router's judgement is a model's and is exercised by hand.

## Open questions

- Discord would use the same router. Nobody has asked.
- Cost is one small model call per message. If that ever matters, the obvious
  lever is answering trivially-shaped questions from a cache, and it is not
  worth building before it does.

## Changelog

- **2026-09-23** — Amended by [0016](0016-read-only-bot.md). The decisions are
  now `answer`, `bug` and `unclear`: `change` and `fix` started the pipeline
  and `fix.sh`, and the bot no longer writes. A router report saying either is
  refused rather than acted upon.

| Date | Change | Why |
|---|---|---|
| 2026-09-19 | Fourth decision `fix`, for repairing the machinery | A broken agent is not a product change and had no door; the bot could diagnose it and not act |
| 2026-09-18 | Created | 0012 treated every non-command message as a change request, so asking a question launched the spec agent |
