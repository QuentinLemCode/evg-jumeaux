/**
 * Prints a bcrypt hash for a 6-digit PIN, to paste into
 * src/db/seed/users.ts (spec 0002, rule 6).
 *
 *   npm run hash-pin 482915
 *
 * The PIN itself is never written anywhere: it stays in your shell history and
 * in the message you send to the player.
 */
import bcrypt from 'bcryptjs';

const pin = process.argv[2];

if (!pin) {
  console.error('usage: npm run hash-pin <6-digit-pin>');
  process.exit(1);
}
if (!/^\d{6}$/.test(pin)) {
  console.error(`'${pin}' is not a 6-digit PIN`);
  process.exit(1);
}

const hash = bcrypt.hashSync(pin, 12);

console.log(hash);
console.error('\npaste this as the player\'s pinHash in src/db/seed/users.ts');
