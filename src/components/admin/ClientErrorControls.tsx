'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { setClientErrorResolved } from '@/lib/actions/admin';

import { Button } from '../ui/Button';
import { ErrorMessage } from '../ui/Field';

/**
 * Resolve or reopen one browser-error group (spec 0011, rule 18).
 *
 * Nothing is deleted: the count and the first-seen date are the evidence it
 * happened. And a later occurrence reopens it on its own, in the report
 * endpoint — a bug that comes back is news.
 */
export function ClientErrorControls({
  fingerprint,
  resolved,
}: {
  fingerprint: string;
  resolved: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3">
      <ErrorMessage>{error}</ErrorMessage>
      <Button
        size="sm"
        variant={resolved ? 'secondary' : 'ghost'}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await setClientErrorResolved({ fingerprint, resolved: !resolved });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.refresh();
          });
        }}
      >
        {resolved ? 'Rouvrir' : 'Marquer comme traitée'}
      </Button>
    </div>
  );
}
