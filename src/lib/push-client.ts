/**
 * Browser-side Web Push helpers (spec 0006). Client only: no database import,
 * no server secret — the VAPID *public* key is all the browser needs.
 */

export type PushPlatform = 'ios-safari' | 'android' | 'desktop' | 'unsupported';

export function detectPlatform(): PushPlatform {
  if (typeof navigator === 'undefined') return 'unsupported';
  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos) return 'ios-safari';
  if (/Android/.test(ua)) return 'android';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  return 'desktop';
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's non-standard flag, still the only reliable signal there.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * On iOS, Web Push only exists inside an installed PWA. Asking for permission
 * in Safari there produces a prompt that cannot succeed, so the app shows
 * install instructions instead (spec 0006, rule 4).
 */
export function needsInstallFirst(): boolean {
  return detectPlatform() === 'ios-safari' && !isStandalone();
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalised);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export type SubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string;
};

function serialise(subscription: PushSubscription): SubscriptionPayload | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return {
    endpoint: json.endpoint,
    keys: { p256dh, auth },
    userAgent: navigator.userAgent.slice(0, 300),
  };
}

/** Subscribes without prompting. Returns null when permission is not granted. */
export async function getExistingSubscription(
  vapidPublicKey: string,
): Promise<SubscriptionPayload | null> {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));
  return serialise(subscription);
}

/** Prompts, then subscribes. Only ever called from the explanation screen. */
export async function requestAndSubscribe(
  vapidPublicKey: string,
): Promise<
  | { status: 'granted'; subscription: SubscriptionPayload }
  | { status: 'denied' | 'dismissed' | 'unsupported' | 'needs-install' | 'failed' }
> {
  if (!pushSupported()) return { status: 'unsupported' };
  if (needsInstallFirst()) return { status: 'needs-install' };

  const permission = await Notification.requestPermission();
  if (permission === 'denied') return { status: 'denied' };
  if (permission !== 'granted') return { status: 'dismissed' };

  const subscription = await getExistingSubscription(vapidPublicKey);
  if (!subscription) return { status: 'failed' };
  return { status: 'granted', subscription };
}
