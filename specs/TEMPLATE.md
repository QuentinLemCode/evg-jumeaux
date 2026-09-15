# NNNN — Title

| | |
|---|---|
| **Status** | draft \| ready-for-code \| implemented \| superseded |
| **Owner** | spec agent |
| **Depends on** | NNNN, NNNN |
| **Ready for code** | yes \| no |

## Intent

One paragraph: what problem this solves for the people at the party, and why it
is worth building. If you cannot state the user-visible benefit, the spec is
probably describing an implementation, not a feature.

## Behaviour

What the system does, in the present tense, from the outside. Numbered rules
are easier to reference from acceptance criteria and from code review than
prose.

## Data model

New or changed tables and columns, and — explicitly — what happens to rows that
already exist in production. History is never dropped.

## Authorisation

Who may perform each operation, checked server-side. One row per operation.

| Operation | Who |
|---|---|

## Failure cases

Every way this can go wrong, and what the user sees. An unspecified failure
case becomes an unhandled exception.

| Case | Behaviour | User-facing message (French) |
|---|---|---|

## Acceptance criteria

Checkable statements. A reviewer must be able to mark each one true or false
from the code, with no judgement call.

- [ ] …

## Out of scope

What this spec deliberately does not cover. This is what stops the code agent
from widening the diff.

## Open questions

Anything that had to be guessed. If a guess would change the implementation,
set **Ready for code: no**.

## Changelog

| Date | Change | Why |
|---|---|---|
| YYYY-MM-DD | Created | |
