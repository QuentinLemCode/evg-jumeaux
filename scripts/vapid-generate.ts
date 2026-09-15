/**
 * Generates a VAPID key pair for Web Push (spec 0006). Run once, per
 * environment, and put the result in .env — the private key must never be
 * committed and must never reach the client bundle.
 *
 *   npm run vapid:generate
 */
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
console.error(
  '\nadd these three lines to .env (and to the GitHub secrets for the VM).\n' +
    'regenerating them invalidates every existing push subscription.',
);
