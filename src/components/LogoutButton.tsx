'use client';

import { useTransition } from 'react';

import { logout } from '@/lib/actions/auth';

import { Button } from './ui/Button';

export function LogoutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      full
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(() => logout())}
    >
      {pending ? 'Déconnexion…' : 'Se déconnecter'}
    </Button>
  );
}
