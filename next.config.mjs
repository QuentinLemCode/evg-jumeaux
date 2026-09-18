/**
 * Deliberately `.mjs` and not `.ts`: `next start` loads this file at runtime,
 * and a TypeScript config would require the `typescript` package in the
 * production image (Next tries to install it on the fly, which fails for a
 * non-root container user). The JSDoc annotation keeps it typed in the editor.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // better-sqlite3 is a native module: it must stay a real require() at
  // runtime instead of being traced into the server bundle.
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  // Without these, every reported stack trace reads
  // `a.b is not a function at r (page-4f2c.js:1:28104)` — which satisfies the
  // letter of "report the stack trace" and none of its purpose (spec 0011,
  // rules 19-20). The cost is that the client source is fetchable by anyone
  // who asks for the maps; accepted for a private party's leaderboard.
  productionBrowserSourceMaps: true,
  // GIT_COMMIT is deliberately NOT declared in `env`: that would inline the
  // build-time value and freeze it, making /api/health report the wrong commit
  // forever. The health route reads process.env at request time instead, which
  // is what lets the deploy script verify that the container actually restarted.
  async headers() {
    return [
      {
        // The service worker must never be cached, or a deployment can take
        // hours to reach an installed PWA (spec 0009, rule 15).
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
