/**
 * The icon set (spec 0010 §5).
 *
 * Drawn on a 24px grid, `fill="none"`, `stroke="currentColor"` — so every icon
 * takes its colour from the element's state and renders identically on every
 * device. Emoji cannot do either, which is why they are not icons here.
 *
 * The two documented exceptions, both DATA rather than interface: a player's
 * avatar (`users.avatar`, spec 0002) and a game's icon (`games.icon`,
 * spec 0003) are emoji chosen by people, and stay emoji.
 */
import type { SVGProps } from 'react';

const BASE: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export type IconProps = {
  /** Rendered size in px. Nav 22, inline 19, small 16. */
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function svg(path: React.ReactNode) {
  return function Icon({ size = 22, className, strokeWidth }: IconProps) {
    return (
      <svg
        {...BASE}
        width={size}
        height={size}
        strokeWidth={strokeWidth ?? BASE.strokeWidth}
        className={className}
      >
        {path}
      </svg>
    );
  };
}

export const TrophyIcon = svg(
  <>
    <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
    <path d="M7 6H4.5A2.5 2.5 0 0 0 7 8.5" />
    <path d="M17 6h2.5A2.5 2.5 0 0 1 17 8.5" />
    <path d="M12 13v4" />
    <path d="M8.5 20h7l-.8-3H9.3l-.8 3Z" />
  </>,
);

export const DiceIcon = svg(
  <>
    <rect x="4" y="4" width="16" height="16" rx="4.5" />
    <circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none" />
  </>,
);

export const HistoryIcon = svg(
  <>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2" />
    <path d="M3 4v4.2h4.2" />
    <path d="M12 8.2V12l2.8 1.8" />
  </>,
);

export const BellIcon = svg(
  <>
    <path d="M18 9.2a6 6 0 1 0-12 0c0 4.8-2 5.8-2 5.8h16s-2-1-2-5.8Z" />
    <path d="M10.4 18.6a2.1 2.1 0 0 0 3.2 0" />
  </>,
);

export const ShieldCheckIcon = svg(
  <>
    <path d="M12 3.2 5 6.2v5c0 4.5 3 8 7 9.1 4-1.1 7-4.6 7-9.1v-5l-7-3Z" />
    <path d="M9.4 12.2 11 13.8l3.6-3.6" />
  </>,
);

export const CrownIcon = svg(
  <>
    <path d="M3.5 8.5l3.2 2.6L12 5l5.3 6.1 3.2-2.6-1.5 9.5H5L3.5 8.5Z" />
  </>,
);

export const CloseIcon = svg(
  <>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </>,
);

export const SearchIcon = svg(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </>,
);

export const ChevronRightIcon = svg(<path d="M9 5l7 7-7 7" />);

export const ChevronLeftIcon = svg(<path d="M15 5l-7 7 7 7" />);

export const ShareIcon = svg(
  <>
    <path d="M12 3.5v10" />
    <path d="M8.5 7 12 3.5 15.5 7" />
    <path d="M7.5 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18.5 11h-2" />
  </>,
);

export const ScalesIcon = svg(
  <>
    <path d="M12 4.5v15" />
    <path d="M6 8.5h12" />
    <path d="M6 8.5 3.5 14.5h5L6 8.5Z" />
    <path d="M18 8.5l-2.5 6h5L18 8.5Z" />
    <path d="M8.5 19.5h7" />
  </>,
);

export const SlidersIcon = svg(
  <>
    <path d="M4 7.5h16" />
    <path d="M4 16.5h16" />
    <circle cx="9.5" cy="7.5" r="2.3" />
    <circle cx="15" cy="16.5" r="2.3" />
  </>,
);

export const UndoIcon = svg(
  <>
    <path d="M3.5 8.5h9.5a5 5 0 1 1 0 10H8.5" />
    <path d="M7 5 3.5 8.5 7 12" />
  </>,
);

export const ClockIcon = svg(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);

export const EyeIcon = svg(
  <>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
  </>,
);

export const AlertIcon = svg(
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 8v5" />
    <path d="M12 16.2v.1" />
  </>,
);

export const CheckIcon = svg(<path d="M5 12.5l4.5 4.5L19 7" />);

export const BackspaceIcon = svg(
  <>
    <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9L3 12l6-7Z" />
    <path d="M12 9.5l5 5" />
    <path d="M17 9.5l-5 5" />
  </>,
);
