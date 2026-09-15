'use client';

/**
 * A real reload, not a client-side navigation: the offline page exists because
 * the network failed, and recovering from that means re-fetching everything.
 */
export function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="tap-target mt-6 inline-flex items-center rounded-xl bg-coral px-5 py-3 font-semibold text-bg"
    >
      Réessayer
    </button>
  );
}
