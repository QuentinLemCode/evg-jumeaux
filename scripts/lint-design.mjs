/**
 * Design-system linter (spec 0010).
 *
 * The rules a look actually dies of: a hard-coded hex somebody was in a hurry
 * to ship, a blurred shadow from muscle memory, 10px text, an emoji standing in
 * for an icon. None of those are caught by tsc or eslint, and every one of them
 * is invisible in review until the screen looks subtly off.
 *
 * Escape hatch: put `design-lint-allow` (optionally `design-lint-allow:<rule>`
 * to exempt one rule) in a comment on the offending line or on either of the
 * two lines above it — JSX rarely lets you comment in place. `design-lint-
 * allow-file` at the top exempts a whole file and should be rare. Always say
 * why next to it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const SCANNED = ['src/components', 'src/app'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.css']);
/** The only file allowed to define raw colour values. */
const TOKEN_FILE = 'src/app/globals.css';

const RULES = [
  {
    id: 'raw-hex',
    test: /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/,
    message: 'raw hex colour — use a token from globals.css (spec 0010 §1)',
    skipFiles: [TOKEN_FILE],
  },
  {
    id: 'blurred-shadow',
    // Tailwind's blurred shadow utilities. The hard `3px 4px 0` shadow is the
    // identity of the system, so a blurred one is always a mistake here.
    test: /\b(?:shadow-(?:sm|md|lg|xl|2xl|inner)|drop-shadow(?:-\w+)?)\b/,
    message: 'blurred shadow — Confetti uses the hard `sticker` shadow (spec 0010 §2)',
  },
  {
    id: 'tiny-text',
    test: /text-\[(\d+(?:\.\d+)?)px\]/,
    message: 'text below the 11px floor (spec 0010 §3)',
    predicate: (match) => Number.parseFloat(match[1]) < 11,
  },
  {
    id: 'emoji-icon',
    // Any emoji outside a data or illustration context. The exceptions are
    // documented in spec 0010 §5: a player's avatar (users.avatar), a game's
    // icon (games.icon) and a large decorative EmptyState illustration.
    test: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u,
    message: 'emoji used as an icon — draw an inline SVG (spec 0010 §5)',
    allowLine: /avatar|emoji|illustration|game\.icon|gameIcon/i,
  },
  {
    id: 'banned-font',
    test: /\b(?:Inter|Roboto|Arial|Helvetica|Fraunces)\b/,
    message: 'banned typeface — Confetti is Gabarito + Instrument Sans (spec 0010 §3)',
  },
  {
    id: 'competing-animation',
    // Two animation shorthands on one element cancel each other silently.
    test: /\b(?:rise|pop|drift)\b[^"'`]*\b(?:rise|pop|drift)\b/,
    message: 'two motion utilities on one element cancel each other (spec 0010 §4)',
    onlyIn: /className\s*=|class(?:Name)?:/,
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

const findings = [];

for (const scanned of SCANNED) {
  let files;
  try {
    files = walk(join(ROOT, scanned));
  } catch {
    continue;
  }

  for (const file of files) {
    const rel = relative(ROOT, file);
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    // Deliberately a distinct marker: `design-lint-allow` near the top of a
    // file used to exempt the whole file by accident, which quietly disabled
    // every rule for it.
    if (source.includes('design-lint-allow-file')) continue;

    /** An annotation on this line, or within the two lines above it. */
    const exemptedFor = (index, ruleId) => {
      for (let i = Math.max(0, index - 2); i <= index; i += 1) {
        const text = lines[i] ?? '';
        const at = text.indexOf('design-lint-allow');
        if (at === -1) continue;
        const scope = /design-lint-allow:([\w-]+)/.exec(text);
        if (!scope || scope[1] === ruleId) return true;
      }
      return false;
    };

    lines.forEach((line, index) => {
      for (const rule of RULES) {
        if (rule.skipFiles?.includes(rel)) continue;
        if (exemptedFor(index, rule.id)) continue;
        if (rule.onlyIn && !rule.onlyIn.test(line)) continue;
        if (rule.allowLine?.test(line)) continue;
        const match = rule.test.exec(line);
        if (!match) continue;
        if (rule.predicate && !rule.predicate(match)) continue;
        findings.push({
          file: rel,
          line: index + 1,
          rule: rule.id,
          message: rule.message,
          snippet: line.trim().slice(0, 96),
        });
      }
    });
  }
}

if (findings.length === 0) {
  console.log('lint:design — clean');
  process.exit(0);
}

for (const finding of findings) {
  console.error(`${finding.file}:${finding.line}  [${finding.rule}] ${finding.message}`);
  console.error(`    ${finding.snippet}`);
}
console.error(
  `\n${findings.length} design-system violation(s). Fix them, or annotate a` +
    ' deliberate exception with `design-lint-allow` and a reason.',
);
process.exit(1);
