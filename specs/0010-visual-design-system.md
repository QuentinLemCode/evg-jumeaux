# 0010 — Visual design system ("Confetti")

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0009 |
| **Ready for code** | yes |

## Intent

The app has one job beyond recording scores: making a weekend feel like an
event. A sober dark interface records results correctly and feels like
software. "Confetti" — warm cream paper, sticker cards with hard ink borders,
saturated accents, one orchestrated reveal per screen — makes the leaderboard
feel like a game people are playing.

This spec exists because a look is only real if it survives the twentieth
change made by someone who never saw the mockups. It defines the system as
values in code, not as taste, so that a new screen inherits it by default and
a divergence is a build failure rather than a matter of opinion.

## The system

### 1. Colour

Every colour in the app is one of these tokens. There are no other colours.

| Token | Value | Use |
|---|---|---|
| `bg` | `#fff8ee` | page background (warm cream) |
| `bg-elevated` | `#fffdf8` | quiet rows, de-emphasised cards |
| `surface` | `#ffffff` | card background |
| `ink` | `#1d1a17` | borders, shadows, primary text |
| `muted` | `#6f6357` | secondary text (5.7:1 on `bg` — the lightest text allowed) |
| `faint` | `#a3988a` | placeholder text only, never a sentence |
| `hairline` | `#e3d8c8` | dividers inside a card |
| `coral` | `#ff5d5d` | primary action, active navigation |
| `tangerine` | `#ff9f1c` | first place, step numbers |
| `grape` | `#7b5cff` | the reader's own row, margin bonus |
| `mint` | `#17c98f` | success, validated results, points gained |
| `sky` | `#2ea8ff` | second place, informational |
| `gold` | `#ffb703` | medals, highlights |

There is no separate `primary`, `success` or `danger` token: destructive
actions use `coral` like the primary action and are told apart by **shape** —
an outline sticker rather than a filled one. Three names for one hex is how a
palette quietly becomes two palettes.

Accent tints for card backgrounds are the accent at ~8% over `surface`
(`#ffeee6` coral, `#fff3cf` tangerine, `#f3efff` grape, `#eafaf3` mint,
`#eef4ff` sky). Darkened accents for text on those tints: `#a06407`
tangerine, `#0f8c68` mint.

### 2. Shape

- Cards: `3px solid ink` border, `20px` radius, **hard** shadow
  `3px 4px 0 ink`. Never a blurred shadow — the sticker look is the identity.
- An accent-coloured card takes the accent for **both** its border and its
  shadow, never one or the other.
- Buttons: same border and radius, shadow `3px 5px 0 ink`, `18px` radius.
- Pills and chips: `2px` border, `999px` radius.
- Avatars: `999px` radius, `3px solid ink`, `bg` fill.

### 3. Type

- Display — **Gabarito** 700/900: every heading, every number, every button
  label. Numbers are always display weight; a score in body type reads as
  a form field.
- Body — **Instrument Sans** 400/500/600: sentences, labels, metadata.
- Fallback stack: `system-ui, sans-serif` on both. Fonts load from Google
  Fonts; nothing else is permitted as a font host.
- Minimum size: **11px**. Below that it is not text, it is texture.
- Explicit `line-height` on every heading and on any text inside a
  fixed-height container: a font that resolves a taller default silently
  pushes content out of the viewport.
- Banned: Inter, Roboto, Arial, Helvetica, Fraunces as *declared* faces.

### 4. Motion

- **One orchestrated reveal per screen**, not scattered micro-interactions:
  cards rise (`translateY(16px)` + opacity, 420 ms) or pop
  (`scale(.72)` + overshoot, 500 ms), staggered 60–80 ms apart, then the
  screen is still.
- `animation-fill-mode: both` on every entrance, so the end state persists.
- At most **one** ambient loop per screen, and it must be low-contrast
  (the drifting confetti). Nothing else repeats.
- One `animation` **shorthand** per element. Two classes both setting the
  shorthand silently cancel one another; combine them into a single
  declaration instead.
- Respect `prefers-reduced-motion: reduce`: entrances resolve immediately,
  ambient loops do not run.

### 5. Icons

- Drawn inline SVG on a 24px grid, `fill="none"`, `stroke="currentColor"`,
  `stroke-width` 2–2.4, round caps and joins. They recolour with state.
- **Never an emoji as an icon** — not in navigation, not in buttons, not as a
  status marker. Emoji render differently on every device and cannot take a
  state colour.
- **Avatars are the one exception**: a player's avatar is an emoji, because
  that is what `users.avatar` stores (spec 0002) and it is already the app's
  vocabulary.

### 6. Layout and touch

- Reference viewport 390×844 (spec 0009 governs the responsive rules).
- Anything tappable is at least **44×44 px**, including filter chips.
- Sibling groups are laid out with flex/grid plus `gap`, never with
  per-element margins or source whitespace.
- A row of chips that can overflow scrolls horizontally with a hidden
  scrollbar; it is never clipped with `overflow: hidden`.

### 7. Contrast

Every text/background pair meets **4.5:1**, and every meaningful glyph or
border meets **3:1**. De-emphasis is expressed by *removing colour* (a grey
score where others are coloured), never by lowering contrast below the floor
or by putting `opacity` on a container that holds text.

### 8. Screen anatomy

Every screen is built from the same parts, in the same order. This is the part
that makes pages look like one app rather than one designer's mood per route,
and it is why a new page needs no design decisions at all.

1. **Page header** — `<PageHeader>`: a display-weight title with an explicit
   line-height, an optional one-line subtitle in `text-muted`, an optional
   action on the right. Never a bare `<h1>` with ad-hoc classes.
2. **Sections** — each introduced by `<SectionTitle>` (display, uppercase,
   tracked, `text-muted`). A screen with one section may omit it.
3. **Lists** — a `<ul>` with `flex flex-col gap-2` of sticker cards, one per
   row. Never a table on a phone; never per-row margins.
4. **The reader's own row** is `sticker-grape`. Nothing else in a list is
   accent-coloured unless it carries meaning (a winner is `mint`).
5. **Numbers** go through `<Score>`, which applies Gabarito, tabular figures
   and the tone. A number typed inline as body text is a defect.
6. **Status** is a `<StatusBadge>`, never ad-hoc coloured text.
7. **Filters** are a `chip-row` of `pill` chips; the active one is filled ink.
8. **Empty states** are `<EmptyState>` with an illustration, a title, one
   line of explanation and — where there is an obvious next move — an action.
9. **The primary action sits at the bottom**, full width, in thumb reach,
   inside a `safe-bottom` sticky container on long screens.
10. **The entrance sequence** is applied with the `reveal` prop on a card
    (`<Card reveal={index}>`) or the `reveal()` helper on anything else
    (`<li {...reveal(index)}>`). One sequence per screen, 70 ms apart, and the
    helper caps the total so the last row of a long list is not held back a
    second and a half. Hero elements use `revealKind="pop"`.

A screen that needs a part this list does not have is a signal to add the part
here first — not to invent a local one.

## Data model

None. This spec changes presentation only.

## Authorisation

None.

## Failure cases

| Case | Behaviour |
|---|---|
| A component needs a colour that is not a token | The change is rejected. Add the token to this spec first, or use an existing one. |
| A designer's mockup uses a blurred shadow | The mockup is wrong; hard shadows are the identity. |
| A font fails to load | The fallback stack renders; explicit `line-height` keeps the layout intact. |
| `prefers-reduced-motion` is set | Entrances complete instantly, ambient loops are off. |
| A screen needs an emoji as a status marker | Draw an SVG. |

## Acceptance criteria

- [x] Every token in §1 exists in `src/app/globals.css` and nowhere else.
- [x] No file under `src/components/` or `src/app/` contains an **unannotated**
      raw hex colour. Three annotated exceptions exist and are unavoidable:
      the `theme-color` meta tag and the two manifest colours, none of which
      can read a CSS variable.
- [x] `npm run lint:design` fails on a raw hex colour, a blurred `shadow-*`
      utility, a font-size utility below 11px, an emoji used as an icon, a
      banned typeface, or two motion utilities on one element.
- [x] An exception annotation is scoped to a single rule; an unscoped one
      exempts only its own line, and a whole file needs the distinct
      `design-lint-allow-file` marker.
- [x] The CI pipeline runs `lint:design` and fails the build on a violation.
- [x] `scripts/agent/lib.sh` runs `lint:design` as part of the agent gate.
- [x] Navigation icons are inline SVG components, not emoji.
- [x] Player avatars and game icons remain emoji, and the linter documents
      both as data exceptions.
- [x] `Card`, `Button`, `Badge`, `Avatar` and form inputs render with a 3px
      ink border, the system radii and a hard `3px 4px 0` shadow.
- [x] No blurred shadow appears anywhere (enforced).
- [x] An accent card's border and shadow use the same accent colour, because
      the `sticker-<accent>` utilities set both together.
- [x] No rendered text is smaller than 11px (enforced).
- [x] No element has two competing `animation` shorthands (enforced).
- [x] With `prefers-reduced-motion: reduce`, no animation plays and all
      content is visible.
- [x] Gabarito and Instrument Sans are self-hosted by `next/font`, so no
      request leaves the app for a font host.
- [x] `.claude/skills/confetti-ui/SKILL.md` exists and is referenced from
      `AGENTS.md` §5 as binding for any change under `src/components/` or
      `src/app/`.
- [x] The shared parts of §8 exist as components: `PageHeader`,
      `SectionTitle`, `Score`, `StatusBadge`, `EmptyState`, `Badge`, and the
      `reveal()` helper.
- [x] **Every** screen inside the app shell uses `PageHeader` for its title.
      The login screen (`/`) and the offline page are the two documented
      exceptions: both are full-screen centred heroes outside the shell, with
      no navigation and no scrolling content to head.
- [x] **Every** number rendered in the app goes through `<Score>` / `<Delta>`,
      including the ticking countdown.
- [x] **Every** list applies the entrance sequence and has an `EmptyState`.
- [x] No screen defines its own header, list-row or status treatment.
- [x] Gabarito on every number, not only headings and buttons.
- [x] An explicit `line-height` on every heading, via `PageHeader` and the
      base layer.
- [x] Exactly one entrance sequence per screen, and at most one ambient loop.

### Remaining

- [ ] Every tappable element measures at least 44×44 px — the shared
      components enforce it via `tap-target`, but a per-screen audit on a real
      device has not been done.
- [ ] Each screen's layout matches its mockup on the design canvas. The
      vocabulary matches; the compositions (the podium on the leaderboard, the
      three-column rules card on a match) have not all been built yet.

## Out of scope

- A light/dark theme switch. Confetti is one committed palette (spec 0009
  rule 19 is hereby superseded: the app is no longer dark).
- Retheming every existing component in one change — that is a follow-up
  pass, done screen by screen, and each screen must satisfy this spec when it
  is touched.
- Custom illustration, mascots, or photography.
- Print or export styling.

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-14 | Created | Human picked the "Confetti" direction from three proposals and asked for rules that keep it enforced |
| 2026-09-14 | System implemented and enforced: tokens, sticker utilities, motion utilities, SVG icon set, self-hosted fonts, `lint:design` wired into CI and the agent gate, `confetti-ui` skill | The look only survives if a new screen inherits it by default and a divergence fails the build |
| 2026-09-14 | §8 screen anatomy added, with `PageHeader`, `Score`/`Delta`, `ChipRow`/`ChipLink`/`ViewSwitch` and the `reveal` helper; every screen converted; the `primary`/`danger`/`success` colour aliases removed | Human requirement that every page follow the same design. Tokens alone are not enough — without shared parts, each page reinvents its header and its list row |
