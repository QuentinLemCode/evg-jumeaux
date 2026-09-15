# 0009 — PWA and responsive shell

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0001, 0006 |
| **Ready for code** | yes |

## Intent

This is a phone app that happens to be a website. It will be used one-handed,
outdoors, on patchy 4G, by people who are not concentrating. It must also work
on a laptop, because someone will project the leaderboard on a TV — but the
laptop is the secondary case, not the reference.

## Behaviour

### Layout

1. The reference viewport is **390 × 844** (iPhone 13/14/15). Every screen is
   designed there first.
2. On viewports under 768px: a fixed bottom navigation bar with 4 or 5
   destinations — Classement, Jeux, Historique, Notifications, and Admin for
   admins. Content scrolls under it, with bottom padding so nothing is hidden.
3. On viewports 768px and wider: the bottom bar becomes a left sidebar, and
   content is centred with a maximum width. No screen is a stretched phone
   layout on desktop.
4. Every tappable target is at least 44 × 44 px.
5. Safe-area insets are respected, so the bottom bar clears the iPhone home
   indicator.
6. No horizontal scrolling at any width from 320px up. Tables that cannot fit
   scroll inside their own container.
7. Primary actions on a phone are within thumb reach — bottom of the screen,
   not top.

### Installability

8. The app ships a web app manifest: name, short name, theme colour, background
   colour, `display: standalone`, `start_url: /`, and maskable icons at 192,
   512 and 1024 px.
9. A dedicated screen explains how to install the app, with instructions
   specific to the visitor's platform — iOS Safari (Share → "Sur l'écran
   d'accueil"), Android Chrome (the install prompt or the menu), desktop.
10. On Android and desktop the app uses the `beforeinstallprompt` event to offer
    a one-tap install. iOS has no such API, so the manual instructions are the
    only path there, and the app must not pretend otherwise.
11. Installation is presented as the way to get notifications, because on iOS it
    literally is (0006 rule 4).

### Service worker

12. A service worker is registered on first load. It exists for two reasons:
    receiving push messages (0006), and serving an offline fallback page.
13. The app shell and static assets are cached. **Data is never cached**: a
    stale leaderboard or a stale invitation is worse than an error message,
    given that invitations expire in five minutes.
14. When the network is unavailable, navigation shows an offline page that
    explains the situation and offers a retry. It does not show stale content
    as if it were current.
15. A new deployment takes effect on the next navigation. The service worker
    does not serve an old build indefinitely.

### Live state

16. Screens that show state other people can change — a pending match, the
    leaderboard, the notification badge — refresh automatically every 10
    seconds while visible, and immediately when the tab regains focus.
17. Refreshing never moves the scroll position or loses typed input.
18. A countdown to an invitation deadline ticks every second client-side,
    without polling the server.

### Look

19. Dark theme by default: the party is mostly at night, and a dark screen is
    kinder in a bar. Colours are defined as tokens in one place.
20. French user-facing copy throughout, informal (`tu`).
21. The app never blocks on a spinner where it can show a skeleton.

## Data model

None.

## Authorisation

| Operation | Who |
|---|---|
| Load the manifest, the service worker, the icons | anyone |
| View the install screen | anyone |
| Everything else | see 0001 |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| Service workers unsupported | App works, no push, no offline page | (silent) |
| Offline navigation | Offline page with a retry button | « Pas de connexion. Réessaie. » |
| Offline action submission | The action fails with a retry affordance; nothing is queued | « Action impossible hors ligne » |
| Install prompt unavailable (iOS) | Manual instructions shown instead | (instructions) |
| Very small viewport (320px) | Layout holds, no horizontal scroll | — |

## Acceptance criteria

- [x] Every screen is usable at 390 × 844 with no horizontal scroll.
- [x] No horizontal scroll at 320px either.
- [x] Under 768px the navigation is a fixed bottom bar; at 768px and above it is
      a sidebar with a max-width content column.
- [x] The Admin destination appears only for admins.
- [x] Every interactive element measures at least 44 × 44 px.
- [x] The bottom bar clears the iOS home indicator via safe-area insets.
- [x] `/manifest.webmanifest` is served and valid, with maskable icons at 192,
      512 and 1024 px.
- [x] The app is installable on Android Chrome and offers a one-tap install.
- [x] iOS Safari shows manual install instructions and no fake prompt.
- [x] A service worker registers on first load.
- [x] Static assets are cached; API and page data responses are not.
- [x] With the network off, navigating shows the offline page, not stale data.
- [x] After a deployment, the next navigation serves the new build.
- [x] Live screens refresh every 10 seconds and on focus, without losing scroll
      position or typed input.
- [x] The invitation countdown ticks client-side every second.
- [x] All user-facing copy is in French; no English string is visible in the UI.

## Out of scope

- Light theme and a theme switcher.
- Offline write queueing / background sync.
- App store packaging.
- Internationalisation beyond French.
- Animations beyond simple transitions.

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-14 | Created | Initial harness and application bootstrap |
