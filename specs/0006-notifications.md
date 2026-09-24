# 0006 — Notifications

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0001, 0004 |
| **Ready for code** | yes |

## Intent

An invitation expires in five minutes, so the invited player has to learn about
it while their phone is in their pocket. Without push notifications the whole
invite/accept flow fails in practice. Every notification is also kept in an
in-app inbox, because push delivery is best-effort on every platform and
unreliable on some.

## Behaviour

### Opt-in

1. Every notification is stored in the in-app inbox, whether or not the player
   enabled push. The inbox is the source of truth; push is a delivery channel.
2. The app asks for notification permission **after** the first login, on a
   dedicated screen that explains why it needs them — never as a bare browser
   prompt on page load, which people reflexively dismiss.
2b. On iOS, the install hint appears on the **login screen, before anyone
   signs in**. An installed iOS web app has its own cookie jar: someone who
   logs in in Safari and then installs has to enter their PIN again inside the
   app. Telling them after login is telling them too late. The instructions
   are inline there, because the explanation screen is behind authentication.
   The hint renders only for iOS Safari with the app not yet installed.
3. A player who declines is reminded once per session by a dismissible banner,
   with a link to the explanation screen. The app never re-triggers the browser
   prompt automatically.
4. On iOS, Web Push requires the app to be installed to the home screen. iOS
   Safari visitors who have not installed it are shown the install instructions
   (0009) instead of a permission prompt that cannot succeed.
5. Push subscriptions are per device. One player may have several.
6. A subscription that the push service rejects as gone (HTTP 404 or 410) is
   deleted. Any other failure increments a counter, and the subscription is
   dropped after 5 consecutive failures.

### Events

7. The following events produce a notification:

| Event | Recipients | Title (French) |
|---|---|---|
| Invitation received | each invited player | « X te défie au palet ! » |
| Match started (all accepted) | every participant | « La partie commence » |
| Invitation declined | the creator | « X a refusé » |
| Invitation expired | every participant | « Invitation expirée » |
| Result reported | every player of the sides that owe validation | « X déclare avoir gagné — à valider » |
| Result validated | every participant | « Résultat validé : +10 pts » |
| Result disputed | every admin, and the reporter | « Résultat contesté » |
| Match cancelled | every participant except the canceller | « Partie annulée » |
| Admin resolved a dispute | every participant | « Un admin a tranché » |
| Clash started | every participant except the admin who started it | « Le grand match commence ! » |
| Clash finished | every participant except whoever validated it | « Le grand match est terminé » |

8. A notification carries a title, a body, and a deep link to the screen where
   the player can act — an invitation links to the match screen, not to the home
   page. Landing somewhere that requires navigation defeats a 5-minute deadline.
9. Notifications are never sent to the player who caused the event.
10. The inbox shows unread notifications first, with a badge count in the
    navigation. Opening a notification marks it read and navigates to its link.
11. Notification delivery never blocks the action that caused it. If the push
    service is slow or down, the state transition still completes and the inbox
    row still exists.

### Delivery, and what a sleeping phone experiences

There is no connection between the server and the phone. The browser
subscribes to **its own vendor's push service** (Chrome → FCM, Firefox →
Mozilla, Safari and iOS → APNs) and hands back an endpoint URL plus two keys;
the server encrypts the payload with those keys, signs a VAPID token, and
POSTs to the endpoint. The push service holds a permanent tunnel to the
operating system, and it is the OS — not this app — that wakes the radio.

Three headers decide what that looks like when the screen is off, and every
one of them is wrong by default:

12. **`TTL`** is how long the push service may hold an undelivered message.
    It is set per event type and matched to the deadline the message is about.
    An invitation gets 6 minutes, slightly more than the window it announces;
    informational events about a closed window get 10 to 30 minutes; a result
    or an award gets 12 hours. The library's default is four weeks, which
    would buzz somebody's phone the next morning about an invitation that
    died before midnight.
13. **`Urgency`** decides whether Android's Doze mode defers the message until
    the device next wakes on its own. `high` wakes the radio immediately and
    is reserved for the genuinely time-critical: an invitation, a result
    awaiting validation, a dispute. Everything else is `normal`, because every
    high-urgency push costs battery and a browser that sees them abused can
    throttle the origin.
14. **`Topic`** lets the push service replace an undelivered message with a
    newer one. There is **one topic per match**, deliberately not one per
    event type: a phone that slept through invitation → started → reported
    should wake to the current state, not to three stale banners about a match
    that is already over.
15. If the phone is off, or offline past the TTL, the push is simply dropped —
    and that is the case the in-app inbox exists for (rule 1). Nothing is lost;
    it is read late instead of pushed.
16. The service worker calls `showNotification` for **every** push it
    receives, including a malformed one. The subscription is created with
    `userVisibleOnly: true`, and a browser that sees a silent push can revoke
    the subscription outright.

## Data model

```
push_subscriptions
  id          text primary key
  user_id     text not null references users(id)
  endpoint    text not null unique
  p256dh      text not null
  auth        text not null
  user_agent  text
  failures    integer not null default 0
  created_at  integer not null
  last_seen_at integer not null

notifications
  id          text primary key
  user_id     text not null references users(id)
  type        text not null   -- one of the events in rule 7
  title       text not null
  body        text not null
  url         text not null   -- in-app deep link
  match_id    text references matches(id)
  read_at     integer
  created_at  integer not null
```

VAPID keys live in the environment (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`), are generated once with `npm run vapid:generate`, and are
never committed. The public key is served to the client; the private key never
leaves the server.

## Authorisation

| Operation | Who |
|---|---|
| Register a push subscription | the authenticated player, for themselves only |
| Delete a push subscription | the authenticated player who owns it |
| Read the inbox | the authenticated player, their own only |
| Mark a notification read | its recipient |
| Send a notification | the system only — there is no user-facing send |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| Permission denied by the browser | Inbox still works; banner offers the explanation screen | « Tu ne recevras pas d'alertes. Les invitations restent dans l'onglet notifications. » |
| Push service returns 404/410 | Subscription deleted silently | (none) |
| Push service returns 5xx | Failure counter incremented, retried on the next event | (none) |
| Service worker unsupported | Push section hidden entirely; inbox unaffected | « Ton navigateur ne gère pas les alertes » |
| iOS Safari, not installed | Install instructions instead of a prompt | « Ajoute l'app à ton écran d'accueil pour recevoir les alertes » |
| Subscribing twice from the same device | The existing row is updated, not duplicated | (none) |
| Notification for a deleted match | Inbox row remains, link shows "partie introuvable" | « Cette partie n'existe plus » |

## Acceptance criteria

- [x] Every event in rule 7 writes an inbox row for each recipient.
- [x] No notification is sent to the actor who caused the event.
- [x] A state transition completes even when the push service is unreachable,
      and the inbox row still exists.
- [x] The permission prompt appears only from the dedicated explanation screen,
      never automatically on page load.
- [x] A player who declined permission sees a dismissible banner at most once
      per session.
- [x] iOS Safari without an installed PWA shows install instructions instead of
      a permission prompt.
- [x] The login screen shows the iOS install hint before sign-in, and shows it
      to nobody else (Android, desktop, or an already-installed app).
- [x] The hint states that the installed app has its own session, and that
      alerts need iOS 16.4 or newer.
- [x] Subscribing from the same device twice results in one subscription row.
- [x] A subscription is deleted after a 410 from the push service.
- [x] A subscription is deleted after 5 consecutive non-410 failures.
- [x] An invitation notification deep-links to that match's screen.
- [x] The navigation badge shows the unread count and clears as rows are read.
- [x] The VAPID private key appears in no HTTP response and no client bundle.
- [x] Every push sets an explicit `TTL`; none inherits the library's four-week
      default.
- [x] An invitation's TTL does not outlive its 5-minute window by more than a
      minute.
- [x] `Urgency: high` is set for invitations, results awaiting validation and
      disputes, and for nothing else.
- [x] Every notification about a match carries a `Topic`, identical for every
      event of that match, so an undelivered one is replaced rather than
      stacked.
- [x] The topic is at most 32 URL-safe characters, as the protocol requires.
- [x] A notification with no match sets no topic.
- [x] The service worker shows a notification for every push, including one
      with an unparsable payload.
- [x] The service worker shows a notification when a push arrives while the app
      is closed, and focuses the existing tab when one is already open.

## End-to-end coverage

`e2e/notifications.spec.ts` `@spec-0006`, `e2e/pwa.spec.ts` `@spec-0006`
- An invitation reaches the invited player's inbox and deep-links to the match; the inviter is not notified.
- The unread badge counts, and clears when read.
- The permission prompt lives on the explanation screen, never on page load.

Push DELIVERY itself is not exercised: it needs a real push service. That is
acceptable because the inbox is the source of truth and push is a channel on
top (rule 1); the delivery policy is unit tested instead.

## Out of scope

- Email or SMS delivery.
- Per-event notification preferences.
- Notification grouping, quiet hours, or sounds.
- Reminders before an invitation expires. (Noted: likely next request.)
- Native mobile apps.

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-14 | Created | Initial harness and application bootstrap |
| 2026-09-14 | Added rules 12-16: explicit per-event `TTL`, `Urgency` and `Topic`, and what happens when the phone is asleep or offline | Every one of the three defaults was wrong: a four-week TTL would buzz a dead invitation the next morning, `normal` urgency lets Doze defer a 5-minute deadline, and no topic means a phone that was asleep wakes to a stack of stale banners |
| 2026-09-14 | Added rule 2b: the iOS install hint moves to the login screen, before sign-in | The installed iOS app has a separate cookie jar, so installing after logging in costs a second PIN entry — and the human asked for an iOS answer that needs no native app |
| 2026-09-24 | Two events for a clash: started and finished (spec 0017) | A clash has no invitation, so nothing else tells the other fourteen guests it has begun — « Match started (all accepted) » is both the wrong trigger and the wrong words |
