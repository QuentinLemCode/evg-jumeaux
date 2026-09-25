# Specifications

This directory is the product contract. `src/` is an implementation of it.
No code change lands without a spec change first — see `AGENTS.md` §6.

## Status board

| Id | Title | Status | Summary |
|---|---|---|---|
| `0001` | [Authentication and sessions](0001-authentication-and-sessions.md) | implemented | First name + 6-digit PIN, JWT cookie valid 4 days, escalating lockout (10 s → 30 min) |
| `0002` | [Users and roles](0002-users-and-roles.md) | implemented | Static seeded roster, `admin` and `user` roles |
| `0003` | [Games catalog](0003-games-catalog.md) | implemented | Admin-managed games: sides, players per side, points, margin bonus |
| `0004` | [Match lifecycle](0004-match-lifecycle.md) | implemented | Invite → accept within 5 min → play → report → validate |
| `0005` | [Scoring and leaderboard](0005-scoring-and-leaderboard.md) | implemented | Append-only point ledger, base points + itemised margin bonus |
| `0006` | [Notifications](0006-notifications.md) | implemented | Web Push (VAPID) + in-app inbox, opt-in prompt |
| `0007` | [Profiles and history](0007-profiles-and-history.md) | implemented | Per-player stats, match history, point-by-point breakdown, Parties / Journal switch |
| `0008` | [Admin console](0008-admin-console.md) | implemented | Game CRUD, dispute resolution, manual adjustments, **public admin log**, tournament reset |
| `0009` | [PWA and responsive shell](0009-pwa-and-responsive-shell.md) | implemented | Mobile-first shell, installable PWA, desktop layout |
| `0010` | [Visual design system (« Confetti »)](0010-visual-design-system.md) | implemented | Cream paper, sticker cards, hard shadows, Gabarito, shared screen anatomy — enforced by `lint:design` |
| `0011` | [Client error reporting](0011-client-error-reporting.md) | implemented | Browser crashes reach a table, an admin screen and the alert channel — grouped, rate limited, no third party |
| `0012` | [Telegram gateway](0012-telegram-gateway.md) | amended by 0016 | Mention-gated bot: commands and change requests reach `scripts/agent/`, one job at a time |
| `0013` | [Natural-language routing](0013-natural-language-routing.md) | amended by 0016 | The bot decides: a question is answered, a bug report becomes a prompt, a vague one gets a question back |
| `0014` | [Conversational memory](0014-conversational-memory.md) | implemented | Remembers the thread, asks blocking questions in the chat, resumes from the answer |
| `0015` | [A staged pipeline the chat can follow](0015-staged-pipeline.md) | superseded by 0016 (bot half) | Stage-by-stage progress in the chat, and the spec is approved by a human before any code is written |
| `0016` | [A read-only bot](0016-read-only-bot.md) | implemented | The bot reads and never writes: bug reports become prompts, questions are answered from the specs and the data; changes move to Antigravity remote control |
| `0017` | [Two teams](0017-two-teams.md) | implemented | Two teams, chosen once and for good, filling at half the roster; a team ledger that counts matches, not members |

Status values: `draft` → `ready-for-code` → `implemented` → `superseded`.

## Conventions

- One spec per coherent feature, named `NNNN-kebab-case-title.md`.
- Amend the existing spec and add a Changelog row. Never write
  `0031-fix-the-thing.md` to patch `0004`.
- English, present tense, behaviour not implementation.
- Acceptance criteria are the deliverable: each is a checkbox a reviewer can
  mark true or false without judgement.
- Every spec names its **end-to-end coverage** and is covered by a test tagged
  `@spec-NNNN`. `npm run lint:e2e-coverage` fails the build otherwise
  (`AGENTS.md` §9).
- Keep a spec under ~250 lines. Past that, it is two specs.

## Glossary

Fixed vocabulary — code, UI and specs use these words and no synonyms.

| Term | Meaning |
|---|---|
| **Player** | A seeded user. There is no sign-up. |
| **Game** | A game *type* ("palet", "rock-paper-scissors"), admin-managed. |
| **Match** | One instance of a game between two or more sides. |
| **Side** | One half of a *match* — several players in a team game, one in a duel. Shown as «Camp 1» / «Camp 2»: it is NOT an «équipe» (spec 0017). |
| **Team** | One of the weekend's two camps, «équipe Julien» or «équipe Pierre». A player belongs to exactly one, for the whole weekend. |
| **Invitation** | A player's pending participation in a match. Expires after 5 min. |
| **Report** | The declaration of the winning side and the scores. |
| **Validation** | A losing-side player confirming or disputing a report. |
| **Point event** | One immutable row in the ledger: base win, margin bonus, or admin adjustment. |
| **Busy** | A player already committed to a match, who cannot join another. |
| **Admin log** | The public, chronological record of every admin intervention on points or results. |
| **Sticker** | The app's card shape: 3px ink border, 20px radius, hard offset shadow. |
