import type { MetadataRoute } from 'next';

/**
 * The web app manifest (spec 0009, rule 8). Installability is not cosmetic:
 * on iOS, Web Push only works from an installed PWA, so this file is what
 * makes notifications possible at all (spec 0006, rule 4).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'EVG des Jumeaux',
    short_name: 'EVG',
    description: 'Classement, défis et parties du week-end.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // design-lint-allow:raw-hex — a web app manifest cannot read a CSS variable
    background_color: '#fff8ee',
    // design-lint-allow:raw-hex — keep in sync with --color-bg
    theme_color: '#fff8ee',
    lang: 'fr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
    ],
  };
}
