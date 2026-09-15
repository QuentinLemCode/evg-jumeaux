'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  BellIcon,
  DiceIcon,
  HistoryIcon,
  ShieldCheckIcon,
  TrophyIcon,
  type IconProps,
} from '@/components/ui/Icon';

/**
 * One navigation component, two shapes (spec 0009, rules 2-3): a fixed bottom
 * bar under 768px where the thumb is, a sidebar above it. Rendering both from
 * one source keeps the destinations from drifting apart.
 *
 * Icons are drawn SVG, not emoji (spec 0010 §5): they take the active colour
 * and render identically on every device.
 */
const DESTINATIONS: {
  href: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
}[] = [
  { href: '/leaderboard', label: 'Classement', Icon: TrophyIcon },
  { href: '/games', label: 'Jeux', Icon: DiceIcon },
  { href: '/history', label: 'Historique', Icon: HistoryIcon },
  { href: '/notifications', label: 'Alertes', Icon: BellIcon },
];

const ADMIN_DESTINATION = {
  href: '/admin',
  label: 'Admin',
  Icon: ShieldCheckIcon,
};

export function AppNav({
  isAdmin,
  unreadCount,
}: {
  isAdmin: boolean;
  unreadCount: number;
}) {
  const pathname = usePathname();
  const destinations = isAdmin ? [...DESTINATIONS, ADMIN_DESTINATION] : [...DESTINATIONS];

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const badge = (href: string) =>
    href === '/notifications' && unreadCount > 0 ? (
      <span className="absolute -top-1.5 -right-2.5 min-w-4.5 rounded-full border-2 border-surface bg-coral px-1 text-[11px] leading-4 font-bold text-surface">
        {unreadCount > 9 ? '9+' : unreadCount}
      </span>
    ) : null;

  return (
    <>
      {/* Phone: bottom bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-ink bg-surface md:hidden">
        <ul className="mx-auto flex max-w-lg">
          {destinations.map(({ href, label, Icon }) => (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={[
                  'tap-target flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-semibold',
                  isActive(href) ? 'text-coral' : 'text-muted',
                ].join(' ')}
              >
                <span className="relative">
                  <Icon size={22} />
                  {badge(href)}
                </span>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Desktop: sidebar */}
      <nav className="fixed top-0 bottom-0 left-0 z-40 hidden w-56 border-r-[3px] border-ink bg-surface px-3 py-6 md:block">
        <p className="display mb-6 px-3 text-lg font-black tracking-tight">EVG des Jumeaux</p>
        <ul className="space-y-1">
          {destinations.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={[
                  'tap-target flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold transition-colors',
                  isActive(href)
                    ? 'bg-coral-tint text-coral'
                    : 'text-muted hover:bg-bg hover:text-ink',
                ].join(' ')}
              >
                <span className="relative">
                  <Icon size={20} />
                </span>
                {label}
                {href === '/notifications' && unreadCount > 0 ? (
                  <span className="ml-auto min-w-5 rounded-full bg-coral px-1.5 text-center text-[11px] font-bold text-surface">
                    {unreadCount}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
