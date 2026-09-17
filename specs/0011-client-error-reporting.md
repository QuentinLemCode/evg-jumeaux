# 0011 — Client error reporting

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0001, 0008, 0010 |
| **Ready for code** | yes |

## Intent

Everything that breaks on the server is visible: the container logs it and the
watcher alerts within two minutes. Everything that breaks **in a guest's
browser** is invisible. A render crash, a Server Action that fails on patchy
4G, a service worker that throws — the guest sees a broken screen, shrugs, and
puts their phone away. Nobody is told, and the weekend is over before anyone
finds out.

This spec makes those failures arrive somewhere. Deliberately in-house: a
table, an endpoint, an admin screen and the alert channel that already exists.
A third-party error service would mean an external account, a new secret, and
guest browsers talking to a domain nobody vetted, for a closed group of fifteen
people over one weekend.

## Behaviour

### What is captured

1. Four kinds of client failure are reported:
   - `render` — a React error caught by an error boundary;
   - `unhandled` — an uncaught exception (`window.onerror`);
   - `rejection` — an unhandled promise rejection;
   - `sw` — a failure inside the service worker.
2. Each report carries: the message, the stack trace, the kind, the path it
   happened on, and the viewport size. The **app commit is stamped by the
   server**, not sent by the client: the server knows which build is answering,
   and a constant baked into the client bundle could disagree with it.
3. **The user is derived from the session cookie server-side, never sent by the
   client.** A client-supplied identity is a client-controlled identity, and an
   error report is the last place to trust one.
4. The **browser** is recorded twice: the raw `User-Agent`, for fidelity, and a
   short readable summary (`Safari 18 · iPhone`) because a raw UA string is
   unreadable in a list of thirty rows.
5. An error on the login screen is accepted with **no user**. A broken session
   is one of the things this is meant to catch, so requiring a session would
   hide it.
6. Not captured, deliberately: no IP address, no breadcrumb trail, no session
   replay, no form contents. The roster is fifteen friends and the user id is a
   first name; anything more is surveillance, not debugging.

### Grouping, because a loop must not fill the disk

7. Reports are **grouped by fingerprint**: the kind, the message with volatile
   parts removed (numbers, UUIDs, hashes), and the first three stack frames.
8. A repeat of a known fingerprint increments a counter and updates
   `last_seen_at`. It does **not** insert a row. One render loop on one phone
   would otherwise write thousands of rows onto a 20 GB disk.
9. A group records: first seen, last seen, count, and the most recent user and
   browser to hit it.

### Limits, because the endpoint is public

10. The endpoint requires no session (rule 5), so it is rate limited:
    **20 reports per IP per 10 minutes**, in memory, and a report over the size
    caps is rejected rather than truncated silently.
11. Caps: message 500 characters, stack 8000, path 300, user agent 300.
12. The client reports each fingerprint **at most once per page load**, and at
    most **5 reports per page load** in total. A page failing in a loop gives
    one useful report, not a denial of service against its own backend.
13. Reporting is fire-and-forget and must never throw: a failure to report an
    error cannot itself break the page.

### What the guest sees

14. An error boundary shows a designed recovery screen in the Confetti
    vocabulary (spec 0010): what happened in one sentence, a **Réessayer**
    button that re-renders, and a link back to the leaderboard. Never a raw
    stack trace — the guest cannot act on it and it looks like the app died.
15. The boundary reports **before** it renders, so a guest who closes the tab
    immediately is still counted.

### What an admin sees

16. `/admin/errors` lists the groups, most recently seen first: the message, the
    kind, the count, when it was first and last seen, the affected path, and
    the last user and browser. Expanding a group shows the full stack trace.
17. The list is admin-only. A stack trace exposes internal structure, and a
    guest can act on none of it.
18. An admin can **resolve** a group, which hides it from the default view
    without deleting it. A later occurrence unresolves it automatically — a
    bug that comes back is news.
19. A group keeps the **first** message it was seen with, so its label is
    stable, while later occurrences refresh the stack, path and viewport. The
    fingerprint groups them; the label should not move under the reader.

### Readable stack traces

20. Production browser source maps are enabled. Without them every trace is
    `a.b is not a function at r (page-4f2c.js:1:28104)`, which satisfies the
    letter of "report the stack trace" and none of its purpose.
21. This publishes the client source to anyone who fetches the maps. Accepted:
    the alternative is traces nobody can read, and the app is a leaderboard for
    a private party, not a product with a secret algorithm.

### Alerting

22. The watcher (spec 0008's alerting path) reports a **new** error group the
    same way it reports a server error: one alert per group, with the short
    diagnosis. A group that only increments its counter does not re-alert.

## Data model

```
client_errors
  id             text primary key
  fingerprint    text not null unique   -- the grouping key (rule 7)
  kind           text not null          -- render | unhandled | rejection | sw
  message        text not null
  stack          text
  path           text not null          -- where it happened, not the full URL
  app_commit     text                   -- which build; a fixed bug stops here
  viewport       text                   -- "390x844", to reproduce it
  count          integer not null        -- occurrences, not rows
  first_seen_at  integer not null
  last_seen_at   integer not null
  last_user_id   text references users(id)
  last_user_agent text
  last_browser   text                   -- the readable summary (rule 4)
  resolved_at    integer                -- null while open (rule 18)
  alerted_at     integer                -- null until the watcher reported it
```

Additive: a new table, nothing existing changes (`AGENTS.md` §8).

`path` and not the full URL on purpose: a query string can carry a `next=`
destination, and there is no reason to store more than the route.

## Authorisation

| Operation | Who |
|---|---|
| `POST /api/client-errors` | anyone, session or not (rule 5), rate limited |
| Read `/admin/errors` | admin |
| Resolve a group | admin |
| Delete a group | nobody — it ages out with the database |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| A render crash | Boundary reports, then shows the recovery screen | « Cet écran a planté. » |
| A crash in the root layout | `global-error` reports and shows a minimal page | « L'application a planté. » |
| Reporting fails (offline, 500) | Swallowed; the page keeps working | (none) |
| Over the size caps | 400, nothing stored | (none) |
| Over the rate limit | 429, nothing stored | (none) |
| Malformed JSON body | 400 | (none) |
| A known fingerprint recurs | Counter and `last_seen_at` updated, no new row | (none) |
| A resolved group recurs | `resolved_at` cleared, so it is visible again | (none) |
| No errors at all | Designed empty state on `/admin/errors` | « Aucune erreur signalée. » |

## Acceptance criteria

- [x] A thrown render error shows the recovery screen, not the default Next.js
      error page, and never a raw stack trace.
- [x] That error appears on `/admin/errors` with its message, kind, path,
      stack, count, user and readable browser.
- [x] An uncaught exception and an unhandled rejection are both reported.
- [x] The user is taken from the session cookie; a report claiming another user
      id is ignored.
- [x] An error reported with no session is stored with no user.
- [x] A second occurrence of the same error increments `count` and does not add
      a row.
- [x] Two different errors produce two groups.
- [x] A fingerprint ignores volatile parts: the same failure with a different
      UUID or number in the message groups together.
- [x] The same fingerprint is reported at most once per page load.
- [x] A report over the size caps is rejected with 400.
- [x] More than 20 reports from one IP in 10 minutes are rejected with 429.
- [x] A failing report never surfaces to the guest and never throws.
- [x] `/admin/errors` is admin-only; a `user` role is redirected.
- [x] Resolving a group hides it from the default view, and reopening it brings
      it back.
- [x] A new occurrence of a resolved group clears `resolved_at`, and does
      **not** clear `alerted_at` — one alert per group, not per occurrence.
- [x] A group's message stays the one it was first seen with; its stack, path
      and viewport follow the latest occurrence.
- [x] `productionBrowserSourceMaps` is enabled and a production stack trace
      names a real source file.
- [x] The watcher's bridge (`app-exec.sh client-errors`) returns only unalerted,
      unresolved groups and stamps what it read, so a second call is silent.
- [ ] The watcher's end-to-end path (agents VM → app VM → alert channel) has
      not been exercised: it needs both VMs. The SQL and the stamping are
      verified locally; the Tailscale hop is not.
- [x] The endpoint accepts both `application/json` and the `text/plain` body
      that `navigator.sendBeacon` sends by default.
- [x] Unit tests cover the fingerprint and the browser summary.
- [x] The admin screen follows spec 0010 §8.

## End-to-end coverage

`e2e/client-errors.spec.ts` `@spec-0011`
- A page that throws during render shows the recovery screen, and the error
  then appears on `/admin/errors` with the logged-in guest and their browser.
- An unhandled promise rejection is reported.
- The same error twice produces one group with a count of two.
- A plain player is redirected away from `/admin/errors`.

### The crash route

Testing an error boundary requires something that errors, and a component
cannot be made to fail on demand from outside. So `src/app/(app)/e2e-crash`
throws during render — but only when `E2E_CRASH_ROUTE=1`, which only
`playwright.config.ts` sets. Everywhere else, production included, it is a 404.
The default is the safe one: the throw needs an explicit opt-in, the 404 needs
nothing.

## Out of scope

- A third-party error service (Sentry and friends) — rule stated in Intent.
- Breadcrumbs, session replay, performance tracing, source-map symbolication
  server-side.
- Alerting a guest that their error was recorded.
- Grouping across app versions: a fingerprint is per message and stack, so the
  same bug before and after a refactor may split. Acceptable for a weekend.
- Deleting or exporting groups.

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-17 | Created | Human asked whether browser errors are reported. They were not: no error boundary, no listeners, and minified traces. |
| 2026-09-17 | Implemented: grouped table, public rate-limited endpoint, root-level listeners, two error boundaries, admin screen, watcher bridge, production source maps | |
