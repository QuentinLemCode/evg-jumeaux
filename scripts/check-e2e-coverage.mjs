/**
 * Every specified feature must be reachable from an end-to-end test
 * (AGENTS.md §10).
 *
 * The convention is a Playwright tag on the describe block:
 *
 *   test.describe('A match from invitation to points',
 *     { tag: ['@spec-0004', '@spec-0005'] }, () => { … });
 *
 * which makes the link machine-checkable AND runnable:
 *
 *   npx playwright test --grep @spec-0004
 *
 * Without this check the rule is a comment in a markdown file, and a spec
 * lands with unit tests only — which is exactly how a flow that works in
 * pieces stops working as a whole.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const SPEC_DIR = 'specs';
const E2E_DIR = 'e2e';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (['.ts', '.tsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

const specs = readdirSync(SPEC_DIR)
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .map((f) => ({ id: f.slice(0, 4), file: join(SPEC_DIR, f) }))
  .sort((a, b) => a.id.localeCompare(b.id));

if (specs.length === 0) {
  console.log('lint:e2e-coverage — no numbered specs, nothing to check');
  process.exit(0);
}

let files = [];
try {
  files = walk(E2E_DIR);
} catch {
  console.error(`lint:e2e-coverage — no ${E2E_DIR}/ directory at all.`);
  process.exit(1);
}

const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');
const tagged = new Set([...source.matchAll(/@spec-(\d{4})/g)].map((m) => m[1]));

/**
 * A spec may declare itself unreachable from a browser — but it has to say so
 * out loud, in the spec, with a reason a reviewer can weigh.
 */
const EXEMPT_MARKER = 'E2E coverage: not applicable';

const missing = [];
for (const spec of specs) {
  if (tagged.has(spec.id)) continue;
  const text = readFileSync(spec.file, 'utf8');
  if (text.includes(EXEMPT_MARKER)) continue;
  missing.push(spec);
}

const unknown = [...tagged].filter((id) => !specs.some((s) => s.id === id)).sort();

for (const spec of missing) {
  console.error(`${spec.file}  no end-to-end test carries the tag @spec-${spec.id}`);
}
for (const id of unknown) {
  console.error(`e2e/  tag @spec-${id} refers to a spec that does not exist`);
}

if (missing.length === 0 && unknown.length === 0) {
  console.log(
    `lint:e2e-coverage — ${specs.length} spec(s), all covered ` +
      `(${files.length} test file(s))`,
  );
  process.exit(0);
}

if (missing.length > 0) {
  console.error(
    `\n${missing.length} spec(s) have no end-to-end test. Add one and tag its` +
      ' describe block:\n' +
      "    test.describe('…', { tag: '@spec-NNNN' }, () => { … });\n" +
      'If the spec genuinely cannot be exercised from a browser, say so in the' +
      ` spec with the line "${EXEMPT_MARKER}" and why.`,
  );
}
process.exit(1);
