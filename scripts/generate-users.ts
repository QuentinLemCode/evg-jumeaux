/**
 * Generate the seedUsers array from a private roster file.
 *
 * Input format, one user per line:
 *   Name,pin,role
 *
 * The role may be empty and defaults to user. The input file is never written
 * to or included in the generated output, so PINs only exist as hashes there.
 *
 *   npm run generate-users -- guests.txt > generated-users.txt
 */
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';

const EMOJIS = ['🧠', '👑', '🐻', '🦊', '🦉', '🐺', '🦁', '🐯', '🦅', '🐗', '🦌', '🐸', '🦈', '🐙', '🦄'];
const inputPath = process.argv[2];

if (!inputPath) {
  console.error('usage: npm run generate-users -- <roster-file>');
  process.exit(1);
}

function userId(name: string): string {
  const id = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (!id) {
    throw new Error(`cannot derive an id from name '${name}'`);
  }
  return id;
}

const users = readFileSync(inputPath, 'utf8')
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), number: index + 1 }))
  .filter(({ line }) => line && !line.startsWith('#'))
  .map(({ line, number }) => {
    const fields = line.split(',').map((field) => field.trim());
    if (fields.length !== 3 || !fields[0] || !/^\d{6}$/.test(fields[1])) {
      throw new Error(`line ${number}: expected Name,6-digit-pin,role`);
    }

    const [name, pin, roleValue] = fields;
    const role = roleValue === '' ? 'user' : roleValue;
    if (role !== 'user' && role !== 'admin') {
      throw new Error(`line ${number}: role must be empty, user, or admin`);
    }

    return {
      id: userId(name),
      name,
      role,
      avatar: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
      pinHash: bcrypt.hashSync(pin, 12),
    };
  });

const ids = new Set<string>();
for (const user of users) {
  if (ids.has(user.id)) {
    throw new Error(`duplicate id '${user.id}'`);
  }
  ids.add(user.id);
}

console.log('export const seedUsers: SeedUser[] = [');
for (const user of users) {
  console.log(`  ${JSON.stringify(user)},`);
}
console.log('];');