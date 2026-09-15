/**
 * The entrance sequence (spec 0010 §8, rule 10).
 *
 * One helper so the rhythm is defined once. Spread it onto the element:
 *
 *   <li {...reveal(index)}>…</li>
 *   <div {...reveal(0, 'pop')}>…</div>
 *
 * The delay is capped: a 30-row leaderboard staggered at 70 ms would hold the
 * last row back for two seconds, which reads as a broken page rather than as
 * a reveal.
 */
const STEP_S = 0.07;
const MAX_STEPS = 8;

export function reveal(
  index = 0,
  kind: 'rise' | 'pop' = 'rise',
): { className: string; style: { animationDelay: string } } {
  const steps = Math.min(Math.max(index, 0), MAX_STEPS);
  return {
    className: kind,
    style: { animationDelay: `${(steps * STEP_S).toFixed(2)}s` },
  };
}
