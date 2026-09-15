/**
 * Refuses a migration that cannot survive a blue/green deploy (AGENTS.md §8).
 *
 * The deploy applies migrations while the PREVIOUS release is still serving
 * every request, and both releases then run against the same schema for a few
 * seconds. A drop, a rename, or a new NOT NULL column without a default takes
 * the site down during the switch — and a rollback cannot fix it, because the
 * schema has already changed.
 *
 * Deliberately not a one-line grep: `NOT NULL` inside a CREATE TABLE is
 * perfectly safe (a new table has no old rows and no old readers), and a grep
 * that flags it trains everybody to ignore the check.
 *
 * Escape hatch: `-- additive-ok <reason>` on the offending line.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/db/migrations';

const RULES = [
  {
    id: 'drop',
    test: /\bDROP\s+(TABLE|COLUMN)\b/i,
    why: 'the previous release still reads it during the switch',
  },
  {
    id: 'rename',
    test: /\bRENAME\s+(TO|COLUMN)\b/i,
    why: 'the previous release still uses the old name — expand/backfill/contract instead',
  },
  {
    id: 'alter-column',
    test: /\bALTER\s+COLUMN\b/i,
    why: 'a type or constraint change is not backwards compatible',
  },
];

let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
} catch {
  console.log('lint:migrations — no migrations directory, nothing to check');
  process.exit(0);
}

const findings = [];

for (const file of files) {
  const path = join(DIR, file);
  const lines = readFileSync(path, 'utf8').split('\n');

  // Statements are separated by drizzle's marker or by a semicolon; we only
  // need to know whether a line sits inside a CREATE TABLE body.
  let inCreateTable = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^CREATE\s+TABLE\b/i.test(trimmed)) inCreateTable = true;

    if (!trimmed.includes('additive-ok')) {
      for (const rule of RULES) {
        if (rule.test.test(line)) {
          findings.push({ path, line: index + 1, rule: rule.id, why: rule.why, text: trimmed });
        }
      }

      // A new NOT NULL column with no default fails on the existing rows AND
      // on the previous release, which does not write it. Inside a CREATE
      // TABLE it is fine: there are no existing rows and no old readers.
      if (
        !inCreateTable &&
        /\bADD\b/i.test(line) &&
        /\bNOT\s+NULL\b/i.test(line) &&
        !/\bDEFAULT\b/i.test(line)
      ) {
        findings.push({
          path,
          line: index + 1,
          rule: 'not-null-without-default',
          why: 'existing rows have no value, and the previous release does not write the column',
          text: trimmed,
        });
      }
    }

    if (inCreateTable && /\)\s*;?\s*$/.test(trimmed)) inCreateTable = false;
  });
}

if (findings.length === 0) {
  console.log(`lint:migrations — ${files.length} migration(s), all additive`);
  process.exit(0);
}

for (const f of findings) {
  console.error(`${f.path}:${f.line}  [${f.rule}] ${f.why}`);
  console.error(`    ${f.text.slice(0, 110)}`);
}
console.error(
  `\n${findings.length} migration statement(s) cannot survive a blue/green deploy.\n` +
    'See AGENTS.md §8 — rename and remove take three releases (expand, backfill,\n' +
    'contract). If a statement is genuinely safe, annotate the line with\n' +
    '`-- additive-ok <reason>`.',
);
process.exit(1);
