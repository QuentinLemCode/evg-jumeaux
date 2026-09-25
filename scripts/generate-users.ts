/**
 * Turns a private roster file into the two things the app needs — and keeps
 * them apart.
 *
 * Input, one guest per line (`#` comments and blank lines ignored):
 *
 *     Name,123456,role        # role may be empty and defaults to user
 *
 * Output:
 *
 *   1. `src/db/seed/users.ts` — ids, names, roles, avatars. Committed.
 *   2. `.secrets/seed-pin-hashes.json` — id -> bcrypt hash. NEVER committed;
 *      it goes in the `SEED_PIN_HASHES` secret.
 *
 * The split is the point. A 6-digit PIN is a million possibilities and bcrypt
 * at cost 12 runs at thousands of guesses a second on one GPU, so a hash in a
 * public repository is a PIN anyone recovers in minutes — and the escalating
 * lockout cannot help, because that attack never touches the login form.
 *
 *     npm run generate-users -- user-seed.txt
 */
import bcrypt from 'bcryptjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const EMOJIS = [
  '🧠',
  '👑',
  '🐻',
  '🦊',
  '🦉',
  '🐺',
  '🦁',
  '🐯',
  '🦅',
  '🐗',
  '🦌',
  '🐸',
  '🦈',
  '🐙',
  '🦄',
];

const ROSTER_FILE = 'src/db/seed/users.ts';
const SECRET_FILE = '.secrets/seed-pin-hashes.b64';
const BEGIN = '// generate-users:begin';
const END = '// generate-users:end';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: npm run generate-users -- <roster-file>');
  process.exit(1);
}

function fail(message: string): never {
  console.error(`generate-users: ${message}`);
  process.exit(1);
}

function userId(name: string): string {
  const id = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (!id) fail(`cannot derive an id from name '${name}'`);
  return id;
}

type Parsed = {
  id: string;
  name: string;
  role: 'admin' | 'user';
  avatar: string;
  pinHash: string;
  teamSlug?: string;
};

/**
 * One emoji per guest, assigned round-robin rather than at random: two people
 * sharing an avatar is confusing on the login screen, and a random pick
 * collides almost immediately at this roster size.
 */
function avatarFor(index: number): string {
  const emoji = EMOJIS[index % EMOJIS.length];
  if (!emoji) fail('unreachable: EMOJIS is not empty');
  return emoji;
}

const users: Parsed[] = readFileSync(inputPath, 'utf8')
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), number: index + 1 }))
  .filter(({ line }) => line && !line.startsWith('#'))
  .map(({ line, number }, index) => {
    const fields = line.split(',').map((field) => field.trim());
    const [name, pin, roleValue, avatarValue, teamValue] = fields;
    if (fields.length < 3 || fields.length > 5 || !name) {
      fail(`line ${number}: expected Name,6-digit-pin,role[,avatar[,team]]`);
    }
    if (!/^\d{6}$/.test(pin ?? '')) {
      fail(`line ${number}: the PIN must be exactly 6 digits`);
    }

    const role = roleValue === '' ? 'user' : roleValue;
    if (role !== 'user' && role !== 'admin') {
      fail(`line ${number}: role must be empty, user, or admin`);
    }

    const teamSlug = teamValue || undefined;
    if (teamSlug && teamSlug !== 'julien' && teamSlug !== 'pierre') {
      fail(`line ${number}: team must be empty, 'julien', or 'pierre'`);
    }

    return {
      id: userId(name),
      name,
      role,
      avatar: avatarValue || avatarFor(index),
      pinHash: bcrypt.hashSync(pin as string, 12),
      ...(teamSlug ? { teamSlug } : {}),
    };
  });

if (users.length === 0) fail(`${inputPath} lists no guests`);

const seen = new Set<string>();
for (const user of users) {
  if (seen.has(user.id)) fail(`duplicate id '${user.id}' — two guests resolve to the same id`);
  seen.add(user.id);
}
if (!users.some((u) => u.role === 'admin')) {
  fail('no admin in the roster — at least one guest must have role "admin"');
}

// ---- 1. The roster, into the committed seed file -------------------------
const existing = readFileSync(ROSTER_FILE, 'utf8');
const begin = existing.indexOf(BEGIN);
const end = existing.indexOf(END);
if (begin === -1 || end === -1) {
  fail(`${ROSTER_FILE} has no ${BEGIN} / ${END} markers to replace`);
}

const rosterBlock = [
  `${BEGIN} — replaced wholesale by \`npm run generate-users\`.`,
  'export const seedRoster: RosterEntry[] = [',
  ...users.map(
    (u) =>
      `  { id: '${u.id}', name: '${u.name.replace(/'/g, "\\'")}', ` +
      `role: '${u.role}', avatar: '${u.avatar}'${u.teamSlug ? `, teamSlug: '${u.teamSlug}'` : ''} },`,
  ),
  '];',
  END,
].join('\n');

writeFileSync(ROSTER_FILE, existing.slice(0, begin) + rosterBlock + existing.slice(end + END.length));

// ---- 2. The hashes, into a file that is never committed ------------------
//
// Base64, not raw JSON. A bcrypt hash starts with `$2b$12$`, and Docker
// Compose interpolates `$` in the project `.env` it also feeds to the
// container as an env_file — raw JSON arrives truncated at the first `$`,
// still looking enough like a hash to be seeded. Measured, not assumed.
const hashes = Object.fromEntries(users.map((u) => [u.id, u.pinHash]));
const encoded = Buffer.from(JSON.stringify(hashes)).toString('base64');
mkdirSync(dirname(SECRET_FILE), { recursive: true });
writeFileSync(SECRET_FILE, `${encoded}\n`, { mode: 0o600 });
writeFileSync(`${SECRET_FILE}.json`, `${JSON.stringify(hashes, null, 2)}\n`, { mode: 0o600 });

const gitignored = existsSync('.gitignore') && readFileSync('.gitignore', 'utf8').includes('.secrets/');
const admins = users.filter((u) => u.role === 'admin').map((u) => u.name);

console.log(`
generate-users: ${users.length} guests (${admins.length} admin: ${admins.join(', ')})

  1. ${ROSTER_FILE}
     Rewritten between the markers. Safe to commit — no hash in it.

  2. ${SECRET_FILE}
     ${users.length} hashes, base64, mode 0600.${gitignored ? '' : '  ⚠  .secrets/ IS NOT IN .gitignore'}
     (${SECRET_FILE}.json is the same thing readable, for your eyes only.)

     Base64 because Docker Compose eats the dollar signs in a bcrypt hash
     passed as raw JSON through .env — the seeder refuses a truncated one.

Set the secret, then delete both files:

     gh secret set SEED_PIN_HASHES < ${SECRET_FILE}
     rm -rf .secrets

Terraform passes the same value to the VM as TF_VAR_seed_pin_hashes, but it
lands in the VM's .env only when the startup script runs. So rotating PINs is
three steps, not one:

     gh secret set SEED_PIN_HASHES < ${SECRET_FILE}
     # run the *Deploy infra* workflow
     # then, on the app VM, re-seed against the new hashes:
     tailscale ssh hermes@evg-app
     cd ~/site && docker compose run --rm --no-deps app-blue npm run db:seed

Send each guest their own PIN privately. ${inputPath} holds them in plain text:
keep it out of the repository, or delete it once the PINs are sent.
`);
