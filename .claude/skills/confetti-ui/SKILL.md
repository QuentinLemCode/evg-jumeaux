---
name: confetti-ui
description: Build or change any user interface in this app — a page, a component, a screen, a style. Loads the "Confetti" design system (spec 0010): the tokens, the sticker shapes, the type scale, the one-reveal motion rule, and the checks that enforce them. Use it before touching anything under src/app/ or src/components/.
---

# Confetti — the app's design system

Binding for every change under `src/app/` or `src/components/`. The contract is
`specs/0010-visual-design-system.md`; this is how you apply it.

The look: **warm cream paper, white sticker cards with a hard ink border and an
unblurred offset shadow, saturated accents, one orchestrated reveal per
screen.** If a change makes the app look like sober software, it is wrong.

## Before you write anything

```bash
sed -n '1,120p' src/app/globals.css      # the tokens — the whole palette
cat src/components/ui/Icon.tsx           # the icon set
cat src/components/ui/Card.tsx           # what a card already looks like
```

Then copy the nearest existing screen's structure. New UI **extends** this
vocabulary; it never introduces a second one.

## Build the screen from the shared parts

Spec 0010 §8 is the anatomy, and it is not optional: a new page needs no design
decisions, only these parts in this order.

```tsx
<PageHeader title="Classement" subtitle="…" action={<ButtonLink …/>}>
  {/* optional: <ViewSwitch views={…} /> */}
</PageHeader>

<SectionTitle>À toi de jouer</SectionTitle>

<ChipRow><ChipLink href="…" active>Tout</ChipLink></ChipRow>

<ul className="flex flex-col gap-2">
  {rows.map((row, index) => (
    <li key={row.id}>
      <CardLink href={`/…`} reveal={index} accent={isMe ? 'grape' : undefined}>
        …
        <Score value={row.points} tone="coral" suffix="pts" />
        <StatusBadge status={row.status} />
      </CardLink>
    </li>
  ))}
</ul>

{rows.length === 0 ? <EmptyState illustration="🏆" title="…" /> : null}
```

- Every title is a `PageHeader`. Never a bare `<h1>` with ad-hoc classes.
- Every number is a `<Score>` or `<Delta>` — including a countdown. A number
  typed inline as body text is a defect.
- Every list applies the entrance sequence (`reveal={index}` on a card, or
  `{...reveal(index)}` elsewhere) and has an `EmptyState`.
- The reader's own row is `accent="grape"`. A winner is `mint`. Nothing else
  in a list is accent-coloured.
- The primary action sits at the BOTTOM, full width, in thumb reach.

If the part you need does not exist, add it to `src/components/ui/` **and** to
spec 0010 §8. Do not build a local one.

## The rules that get broken

### Colour — tokens only, no exceptions
Every colour comes from `globals.css`. A raw hex under `src/app/` or
`src/components/` fails `npm run lint:design`.

| Need | Token |
|---|---|
| page background | `bg-bg` |
| card | `bg-surface` |
| quiet / de-emphasised card | `bg-bg-elevated` |
| borders, shadows, primary text | `ink` |
| secondary text | `text-muted` (the lightest text allowed) |
| placeholder only | `text-faint` |
| divider inside a card | `border-hairline` |
| primary action, active nav | `coral` |
| first place, step numbers | `tangerine` |
| the reader's own row, margin bonus | `grape` |
| success, validated, points gained | `mint` |
| second place, informational | `sky` |

Accent card backgrounds are the `-tint` variants; text on a tint uses the
`-deep` variant (`text-tangerine-deep`, `text-mint-deep`) so it stays readable.

### Shape — use the utilities, don't rebuild them
```html
<div class="sticker p-4">…</div>                <!-- white card -->
<div class="sticker sticker-grape p-4">…</div>  <!-- the reader's own row -->
<button class="sticker-button bg-coral text-bg …">…</button>
<span class="pill px-3">…</span>                <!-- chip -->
```
`sticker-<accent>` sets the border **and** the shadow to the same accent, which
is the rule — never set one without the other by hand.

**There is no blurred-shadow utility in this system.** `shadow-lg`,
`shadow-md`, `drop-shadow` and friends all fail the lint. The hard
`3px 4px 0` shadow is the identity.

### Type
- `class="display"` (Gabarito) on **every heading, every number, every button
  label**. A score in body type reads as a form field.
- Body text is the default (Instrument Sans). Weights 400/500/600.
- **11px floor.** `text-[10px]` and below fail the lint. `text-[11px]` is the
  smallest, for badges and metadata.
- Put an explicit `leading-*` on every heading and on any text inside a
  fixed-height box — a fallback face with a taller default line-height
  silently pushes content off a 390×844 screen.
- Never name Inter, Roboto, Arial, Helvetica or Fraunces.

### Motion — one reveal, then stillness
```html
<div class="rise" style={{ animationDelay: '.08s' }}>…</div>
<div class="pop">…</div>       <!-- pops with overshoot, for hero elements -->
```
Stagger siblings 60–80 ms apart. **One** `rise`/`pop`/`drift` per element:
they each set the `animation` shorthand, so two on one element silently cancel
each other (the lint catches this — it is a bug that already shipped once).
`drift` is the single permitted ambient loop, for background confetti only.
Reduced motion is handled globally in `globals.css`; do not re-implement it.

### Icons — drawn, never emoji
Import from `src/components/ui/Icon.tsx`. Need a new one? Add it there: 24px
grid, `fill="none"`, `stroke="currentColor"`, stroke-width 2–2.4, round caps.

The three documented exceptions, all **data or illustration** rather than
interface: a player's avatar (`users.avatar`), a game's icon (`games.icon`),
and a large decorative `EmptyState illustration`. Everything else is SVG.

### Touch and layout
- `class="tap-target"` (44×44 min) on everything tappable — chips included.
- Sibling groups use flex/grid + `gap`, never per-element margins.
- A chip row that can overflow uses `class="chip-row"` (scrolls, hidden
  scrollbar). Never `overflow-hidden` on a row of chips: it shears the last
  one off flat and reads as a rendering bug.
- Primary actions sit at the bottom of a phone screen, in thumb reach.

### Contrast
4.5:1 for text, 3:1 for a meaningful glyph or border. Express de-emphasis by
**removing colour** — a grey score where others are coloured — never by
dropping below the floor and never with `opacity` on a container holding text.

## The check

```bash
npm run lint:design      # the design system
npm run typecheck && npm test && npm run build
```

`lint:design` runs in CI and fails the build. A deliberate exception is
annotated in place, scoped to the rule, with a reason:

```tsx
// design-lint-allow:raw-hex — browser chrome needs a literal value
themeColor: '#fff8ee',
```

An annotation with no rule name exempts the line for every rule — use the
scoped form. Never reach for `design-lint-allow-file`.

## Reference

The mockups this system was drawn from are a design canvas: six Confetti
screens (login, PIN pad, leaderboard, match detail, notifications/iOS, admin
log) plus the two rejected directions. Ask the user for the link if you need to
see the intended result; the tokens and utilities above are the authority.
