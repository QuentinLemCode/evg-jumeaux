/**
 * Environment validation. Imported from the server entry points so a
 * misconfigured deploy fails at boot with a readable message instead of
 * failing later, per request, with a stack trace.
 */
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.string().default('./data/evg.db'),
  /** Signs the session cookie. Rotating it logs everybody out (spec 0001). */
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  SITE_DOMAIN: z.string().optional(),
  GIT_COMMIT: z.string().default('dev'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * True when Web Push is fully configured. The app degrades gracefully when it
 * is not: the in-app inbox is the source of truth and works regardless
 * (spec 0006, rule 1).
 */
export function pushConfigured(): boolean {
  const e = env();
  return Boolean(
    e.NEXT_PUBLIC_VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY && e.VAPID_SUBJECT,
  );
}
