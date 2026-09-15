import { LiveRefresh } from '@/components/LiveRefresh';
import { MarkAllReadButton, NotificationRow } from '@/components/NotificationList';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireUser } from '@/lib/auth/guards';
import { listInbox, unreadCount } from '@/lib/queries/notifications';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const me = await requireUser('/notifications');
  const [inbox, unread] = await Promise.all([listInbox(me.id), unreadCount(me.id)]);

  return (
    <div className="space-y-4">
      <LiveRefresh />

      <PageHeader
        title="Alertes"
        subtitle={unread > 0 ? `${unread} non lue${unread > 1 ? 's' : ''}` : 'Tout est lu.'}
        action={unread > 0 ? <MarkAllReadButton /> : undefined}
      />

      {inbox.length === 0 ? (
        <EmptyState illustration="🔔"
          title="Aucune alerte"
          action={<ButtonLink href="/install" variant="secondary">Activer les alertes</ButtonLink>}
        >
          Les invitations et les résultats à valider apparaissent ici, même sans
          notifications push.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {inbox.map((notification, index) => (
            <li key={notification.id}>
              <NotificationRow notification={notification} reveal={index} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
