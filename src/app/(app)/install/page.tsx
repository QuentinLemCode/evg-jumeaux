import { InstallInstructions } from '@/components/InstallInstructions';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireUser } from '@/lib/auth/guards';
import { env, pushConfigured } from '@/lib/env';

/**
 * The explanation screen (spec 0006, rule 2 and spec 0009, rule 9).
 *
 * The browser permission prompt is only ever triggered from here, after the
 * player has read why the app wants it — a prompt that appears unprompted on
 * page load gets dismissed reflexively, and that dismissal is hard to undo.
 */
export default async function InstallPage() {
  await requireUser('/install');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reçois les défis à temps"
        subtitle="Une invitation expire au bout de 5 minutes."
      />
      <InstallInstructions
        vapidPublicKey={pushConfigured() ? (env().NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null) : null}
      />
    </div>
  );
}
