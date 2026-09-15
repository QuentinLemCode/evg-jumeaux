/**
 * Expires overdue pending matches (spec 0004, rule 13). Invoked once a minute
 * by the `sweeper` service in docker-compose.yml; the app also expires lazily
 * on read, so a missed sweep never shows a stale invitation as joinable.
 */
import { sweepExpiredMatches } from '../src/lib/sweep';

sweepExpiredMatches()
  .then((expired) => {
    if (expired.length > 0) console.log(`sweep: expired ${expired.length} match(es)`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('sweep: failed', error);
    process.exit(1);
  });
