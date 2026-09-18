import type { Metadata, Viewport } from 'next';
import { Gabarito, Instrument_Sans } from 'next/font/google';

import { ErrorReporter } from '@/components/ErrorReporter';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';

import './globals.css';

/*
 * Self-hosted at build time by next/font (spec 0010 §3): no runtime request to
 * a font host, no flash of fallback metrics, and the app still renders if
 * Google Fonts is unreachable from a guest's phone.
 */
const gabarito = Gabarito({
  subsets: ['latin'],
  weight: ['500', '700', '900'],
  variable: '--font-gabarito',
  display: 'swap',
});

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-instrument',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'EVG des Jumeaux',
  description: 'Classement, défis et parties du week-end.',
  applicationName: 'EVG des Jumeaux',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'EVG',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // design-lint-allow:raw-hex — browser chrome needs a literal; keep in sync with --color-bg
  themeColor: '#fff8ee',
  width: 'device-width',
  initialScale: 1,
  // The layout is designed for one-handed phone use; zooming stays available
  // (never maximum-scale=1) but the default view is the designed one.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${gabarito.variable} ${instrumentSans.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        {/* In the ROOT layout, so a crash on the login screen is reported too
            — the one nobody would otherwise hear about (spec 0011, rule 5). */}
        <ErrorReporter />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
