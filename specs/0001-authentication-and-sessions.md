# 0001 — Authentication and sessions

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0002 |
| **Ready for code** | yes |

## Intent

The guests are a known, closed group of a few dozen people who will open the
app on a phone, once, probably with one hand and a drink in the other. They
must get in within seconds and stay in for the whole weekend. Nobody types an
email address, nobody recovers a password, nobody signs up.

## Behaviour

1. The landing page is the login screen. There is nothing else on it.
2. The login screen shows the roster of seeded players (see 0002) as a
   searchable list of first names, and a 6-digit numeric PIN entry.
3. A player selects their name, enters their PIN, and is logged in.
4. The PIN entry uses a numeric keypad (`inputmode="numeric"`), masks the
   digits, and submits automatically on the sixth digit.
5. A successful login creates a session that lasts **4 days (96 hours) from the
   moment of login**. It does not slide: after 96 hours the player logs in
   again, wherever they are in the app.
6. The session is carried by a cookie that is `httpOnly`, `sameSite=lax`,
   `secure` in production, and `path=/`.
7. Any request to a page other than the login screen without a valid session
   redirects to the login screen, preserving the intended destination so the
   player lands there after logging in.
8. An expired session is indistinguishable from no session.
9. Logging out clears the cookie and returns to the login screen.
10. PINs are never stored in plain text. Only a hash is stored, and only in the
    seed file (see 0002).
11. Login is rate-limited with an **escalating lockout**, per player. A
    6-digit PIN is 10⁶ combinations, so a flat window is not enough: an
    attacker with 15 minutes and a script gets a meaningful number of guesses.
    An escalating delay makes the twentieth attempt cost hours while the third
    costs nothing.

    - The first **3** failed attempts are free — people mistype.
    - After the 3rd failure, each further attempt must wait, and the wait
      grows: **10 s, 30 s, 1 min, 5 min, 10 min, 30 min**, and 30 min for
      every attempt after that.
    - The wait is counted from the last failed attempt, so retrying early
      does not shorten it and does not extend it either.
    - A correct PIN clears the ladder completely.
    - **One hour with no attempt at all also clears it.** Without this, a
      guest who fat-fingers their PIN eight times on Friday faces 30-minute
      waits for the rest of the weekend. An attacker still faces the full
      ladder within any given hour, so the decay costs almost nothing.

12. While a player is locked out, the login screen shows a live countdown and
    the keypad is disabled. A dead keypad with no explanation is worse than
    the lockout it enforces.
13. A failed login never reveals whether the player name or the PIN was wrong —
    though in practice the name is chosen from a list, so only the PIN can be.
14. The lockout is keyed on the player, not the device or the IP: the roster is
    closed and the threat is someone borrowing a phone to log in as a
    teammate, not a distributed attack.

## Data model

No table. The roster lives in the seed (0002). The session is a signed JWT in a
cookie; it is not stored server-side, so there is no session table to prune.

The JWT payload carries: player id, display name, role, issued-at, expiry.
Nothing else — no PIN, no hash. It is signed with `AUTH_SECRET` (HS256).

Rate-limit counters are kept in memory in the app process: a failure count and
the timestamp of the last failure, per player. They are lost on restart, which
resets the ladder — acceptable, because a restart is a deploy and not something
an attacker can trigger.

## Authorisation

| Operation | Who |
|---|---|
| View the login screen | anyone |
| Log in | anyone with a valid name + PIN pair |
| View any other page | any authenticated player |
| Log out | the authenticated player |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| Wrong PIN | Stay on login, clear the PIN field, keep the name selected | « Code incorrect » |
| 4th failed attempt | Refuse without checking the PIN, for 10 s | « Trop de tentatives. Réessaie dans 10 secondes. » |
| 9th and later failed attempts | Refuse without checking the PIN, for 30 min | « Trop de tentatives. Réessaie dans 30 minutes. » |
| Locked out | Keypad disabled, live countdown, re-enables by itself | « Réessaie dans 00:27 » |
| Session expired mid-navigation | Redirect to login with the destination remembered | « Ta session a expiré, reconnecte-toi » |
| `AUTH_SECRET` missing at boot | The app refuses to start | (server log only) |
| Cookie tampered with | Treated as no session | (silent redirect) |

## Acceptance criteria

- [x] The `/` route shows the login screen and nothing else when unauthenticated.
- [x] The roster is rendered from the seed, and only seeded names are selectable.
- [x] A correct name + PIN pair sets a session cookie and lands on the leaderboard.
- [x] The cookie is `httpOnly`, `sameSite=lax`, and `secure` when `NODE_ENV=production`.
- [x] The session's expiry is exactly 96 hours after login.
- [x] A request with an expired token is treated as unauthenticated.
- [x] A request with a token signed by a different secret is rejected.
- [x] Visiting a protected page unauthenticated redirects to login, and after a
      successful login the player lands on the page they originally asked for.
- [x] The first 3 failed attempts are accepted without any wait.
- [x] The 4th attempt is refused without a PIN check until 10 s after the 3rd
      failure, then allowed.
- [x] The wait grows 10 s → 30 s → 1 min → 5 min → 10 min → 30 min across
      successive failures, and stays at 30 min afterwards.
- [x] The wait is measured from the last failed attempt; an early retry
      neither shortens nor extends it.
- [x] A successful login clears the ladder completely.
- [x] One hour with no attempt clears the ladder.
- [x] A locked-out attempt never reaches the PIN comparison.
- [x] The login screen disables the keypad while locked out, shows a live
      countdown, and re-enables itself when it reaches zero.
- [x] No PIN and no PIN hash appears in any HTTP response or log line.
- [x] Logging out clears the cookie and a subsequent protected request redirects.

## Out of scope

- Sign-up, email, password recovery, magic links, OAuth.
- Multi-device session management or remote logout.
- Persisting rate-limit state across restarts.
- Locking out by device or IP address (rule 14 explains why).
- Impersonation by an admin.

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-14 | Created | Initial harness and application bootstrap |
| 2026-09-14 | Flat 5-per-15-minutes limit replaced by an escalating lockout (10 s → 30 min) with a 1-hour idle reset, plus a live countdown on the login screen | Human requirement; a flat window gives a scripted attacker too many guesses at a 6-digit PIN |
