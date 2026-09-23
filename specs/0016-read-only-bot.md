# 0016 — A read-only bot

| | |
|---|---|
| Status | Implemented |
| Supersedes | the bot half of [0015](0015-staged-pipeline.md); the writing half of [0013](0013-natural-language-routing.md) |
| Amends | [0012](0012-telegram-gateway.md) |

## Intent

The bot was given the whole pipeline: a message could write a specification,
run the code agent and open a pull request. In practice it did not work. Each
attempt needed a human to unblock something, and the specification it produced
was read for the first time in a chat window, which is not where a contract
gets read.

So the bot stops writing. It keeps the three things it is genuinely good at,
all of which are reading:

1. **Reporting a production bug** — summarising what broke, and producing a
   prompt a coding agent can be given.
2. **Explaining the app** — answering how a feature works from `specs/` and
   `src/`.
3. **Answering about the data** — who scored most on Saturday, how many
   matches a game has had.

Making changes moves to **Antigravity remote control**: the agents VM keeps a
checkout and the `agy` CLI, and a human drives it from the Antigravity site.
That is a human at a keyboard with a model, which is what the pipeline was
pretending to be.

The point is not that the bot is less capable. It is that **a bot nobody has
to supervise can only be a bot that cannot break anything.**

## Behaviour

### What the bot may do

1. **Rule 1.** The gateway starts **no** process that writes to the
   repository, the database or production. Concretely: `pipeline.sh`,
   `spec.sh`, `code.sh`, `open-pr.sh`, `fix.sh` and `review.sh` are not
   reachable from a message. They stay in `scripts/agent/` because a human at
   a terminal — or an Antigravity session — still uses them, and 0015's
   two-phase split (`--spec-only`, then `--from-spec` once the specification
   has been read) is exactly how a human wants to run it. What 0015 loses is
   the half the BOT owned: the approval gate in the chat, and the staged
   progress rendering, whose only producers were scripts the bot no longer
   runs.
2. **Rule 2.** `/deploy` is removed. Deploying is a write, and the workflow
   already does it from `main`.
3. **Rule 3.** `app-exec.sh` loses `deploy` and `rollback`. The door between
   the two machines becomes read-only, so the question "could the bot deploy"
   has a structural answer and not a policy one.

### Deciding what a message wants

4. **Rule 4.** The router's decisions become `answer`, `bug` and `unclear`.
   `change` and `fix` are gone — there is nothing left for them to start.
5. **Rule 5.** `answer` is a question about the app or the data. The router
   answers it, in French, from the repository and the data snapshot.
6. **Rule 6.** `bug` is a report that something is broken in production. The
   router does **not** try to fix it. It produces two things: a short summary
   for the chat, and a **prompt for a coding agent**, which the human pastes
   into Antigravity.
7. **Rule 7.** `unclear` is unchanged from 0013: one question back, and the
   bot waits.

### The prompt for a coding agent

8. **Rule 8.** A `bug` reply contains, in this order: what is broken in one
   line, then a fenced block holding the prompt. The prompt names the symptom,
   the screen or endpoint, what the reporter observed, and the spec it touches
   when the router can identify one.
9. **Rule 9.** The prompt is text and nothing else. The bot does not run it,
   store it, or offer to run it. A human decides when a change happens.

### The data snapshot

10. **Rule 10.** `app-exec.sh data` returns a bounded, read-only snapshot of
    the application database, as labelled JSON blocks.
11. **Rule 11.** It **never** includes `users.pin_hash` or any column of
    `push_subscriptions`. This is a whitelist of columns, not a filter of
    forbidden ones: a table added later is absent until someone adds it here
    deliberately.
12. **Rule 12.** The model is never given SQL to write. The snapshot is fixed
    queries; the model reads the result. An agent composing SQL against a
    database holding thirteen real people's records is a risk with no matching
    benefit at this size — the whole dataset fits in a prompt.
13. **Rule 13.** The snapshot is fetched at most once every 60 seconds and
    reused in between, so a chatty group does not open an SSH connection per
    message.
14. **Rule 14.** A snapshot that cannot be fetched is not fatal: the router
    still answers questions about the code, and says it could not read the
    data.

### The watcher

15. **Rule 15.** `watch-errors.sh` stops proposing a repair pull request. It
    posts the diagnosis and a coding-agent prompt, exactly as rule 8
    describes. An automatic write with no human in the loop is the thing this
    spec exists to remove.

### Antigravity remote control

16. **Rule 16.** The agents VM runs `agy remote-control` as a systemd
    service, so an Antigravity session can attach to that machine and work in
    the checkout.
17. **Rule 17.** The checkout and the `agy` CLI stay on the agents VM, and
    `refresh_agents` keeps them current. Nothing about that changes.
18. **Rule 18.** The service's state is reported by `status.sh`, because a
    remote-control daemon that quietly died is indistinguishable from one
    nobody has used today.

## Data model

None of its own. The conversation store (0014) is unchanged except that a
pending **approval** can no longer be created — there is nothing to approve.
A store holding one parses as before; it is simply never acted upon.

## Authorisation

Unchanged from 0012: the allowlist decides who may talk to the bot. The change
here is that the worst an authorised message can now do is read.

## Errors

| Situation | What the human sees |
|---|---|
| A bug is reported | The summary, and a prompt to paste into Antigravity |
| The data cannot be read | The answer from the code, and one line saying the data was unavailable |
| A message asks for a change | The bug/prompt path, never a pipeline |
| `/deploy` is typed | The unknown-command reply, listing what exists |

## Acceptance criteria

- [x] No path from a Telegram message reaches `pipeline.sh`, `spec.sh`,
      `code.sh`, `open-pr.sh`, `fix.sh` or `review.sh`.
- [x] `/deploy` is not a command, and typing it lists the commands that exist.
- [x] `app-exec.sh` rejects `deploy` and `rollback`.
- [x] `app-exec.sh data` returns labelled JSON blocks and exits 0.
- [x] The snapshot contains no `pin_hash` and no `push_subscriptions` column,
      asserted against the real schema rather than by reading the query.
- [x] The router's decisions are exactly `answer`, `bug`, `unclear`, and a
      report saying `change` or `fix` is refused rather than acted upon.
- [x] A `bug` reply carries a fenced prompt naming the symptom and the screen.
- [ ] The snapshot is fetched at most once per 60 seconds.
- [ ] A failed snapshot still lets a question about the code be answered.
- [x] `watch-errors.sh` opens no pull request, and its alert carries a prompt.
- [ ] The agents VM runs an `agy remote-control` service, and `status.sh`
      reports whether it is active.

E2E coverage: not applicable — no browser surface. The gateway is a Telegram
client and a process runner; its pure parts are unit-tested, and the
read-only door is asserted against the scripts themselves.

## Open questions

**Three criteria are implemented but not verified, and one of them I could not
verify at all.**

- The snapshot's 60-second cache and the "a failed snapshot still answers"
  fallback live in module state and a child process. They are written and
  reviewed, not executed by a test.
- **`agy remote-control` is unverified.** The tailnet was on another network
  while this was written, so the daemon, the systemd unit and the `status.sh`
  line were never run against the VM. `agy remote-control` does exist —
  `agy --help` lists it, with `start`, `status` and `stop` — but the unit is
  written for a command whose foreground behaviour I have not observed, which
  is why it is `Type=oneshot` with `RemainAfterExit` and an explicit
  `ExecStop`: that shape works whether the command forks or stays. The boot
  script prints `agy remote-control status` right after enabling it, so the
  first deploy says out loud whether the guess held.

## Changelog

- **2026-09-23** — Created. The bot becomes read-only: bug reports with a
  coding-agent prompt, explanations from the repository, answers from a
  bounded data snapshot. Changes move to Antigravity remote control on the
  agents VM.
