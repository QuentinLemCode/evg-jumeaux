/**
 * Display formatting. French, informal, phone-sized — every string here is
 * read by a player, not by a developer.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(timestamp: number, now = Date.now()): string {
  const delta = now - timestamp;
  if (delta < 0) return 'à l’instant';
  if (delta < MINUTE) return 'à l’instant';
  if (delta < HOUR) {
    const minutes = Math.floor(delta / MINUTE);
    return `il y a ${minutes} min`;
  }
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    return `il y a ${hours} h`;
  }
  const days = Math.floor(delta / DAY);
  if (days === 1) return 'hier';
  return `il y a ${days} jours`;
}

export function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

export function dateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

export function signedPoints(points: number): string {
  return points > 0 ? `+${points}` : `${points}`;
}

/**
 * A wait, in the coarsest unit that is still honest: "10 secondes", not
 * "0 minute"; "30 minutes", not "1800 secondes" (spec 0001, rule 11).
 */
export function waitLabel(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} seconde${seconds > 1 ? 's' : ''}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes > 1 ? 's' : ''}`;
}

export function countdown(msRemaining: number): string {
  if (msRemaining <= 0) return '00:00';
  const total = Math.floor(msRemaining / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  active: 'En cours',
  awaiting_validation: 'À valider',
  disputed: 'Contestée',
  completed: 'Terminée',
  cancelled: 'Annulée',
  expired: 'Expirée',
};

export const POINT_TYPE_LABELS: Record<string, string> = {
  match_win: 'Victoire',
  margin_bonus: 'Bonus d’écart',
  admin_adjustment: 'Ajustement admin',
  match_reversal: 'Annulation',
};
