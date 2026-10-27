import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { Empty, ErrorState, formatDate, Loading, MutationError, Postmark, Status, stampDate } from '../ui';

// The signed-in user's notification centre, laid out as delivery slips: a dated counterfoil, a perforation and the message.
// Reading or acknowledging never closes the case or the deadline.

const FILTERS: Array<[string, string]> = [['all', 'All'], ['unread', 'Unread'], ['escalations', 'Overdue and escalations'], ['deadlines', 'Deadlines']];
export const SEVERITY_TONE: Record<string, string> = { INFO: 'NOT_STARTED', REMINDER: 'AWAITING_RESPONSE', OVERDUE: 'OVERDUE', ESCALATION: 'REJECTED' };
export const SEVERITY_LABEL: Record<string, string> = { INFO: 'Update', REMINDER: 'Reminder', OVERDUE: 'Overdue', ESCALATION: 'Escalation' };
const EMAIL_LABEL: Record<string, string> = {
  PENDING: 'Email queued', SENDING: 'Email sending', RETRYING: 'Email retrying', ACCEPTED: 'Email accepted by provider',
  BOUNCED: 'Email bounced', DEAD: 'Email failed', CANCELLED: 'Email cancelled (no longer current)',
};
const EMAIL_TONE: Record<string, string> = { ACCEPTED: 'SATISFIED', BOUNCED: 'DEFICIENT', DEAD: 'DEFICIENT', CANCELLED: 'NOT_APPLICABLE' };

/** Time printed on the slip's counterfoil, India time. */
export function slipTime(v: string) {
  return new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => api.get<{ unreadCount: number }>('/notifications/count'),
    refetchInterval: 30_000,
  });
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');
  const list = useQuery({ queryKey: ['notifications', filter], queryFn: () => api.get<any>(`/notifications${qs({ filter })}`), refetchInterval: 30_000 });
  const [error, setError] = useState<unknown>(null);

  async function act(url: string) {
    setError(null);
    try {
      await api.post(url, {});
      await qc.invalidateQueries({ queryKey: ['notifications'] });
      await qc.invalidateQueries({ queryKey: ['notifications-count'] });
    } catch (e) { setError(e); }
  }

  return (
    <>
      <div className="section-head">
        <h1>Notifications</h1>
        <button onClick={() => act('/notifications/read-all')} disabled={!list.data?.unreadCount}>Mark all read</button>
      </div>
      <p className="muted">Reminders, overdue alerts and escalations ask for attention. Acknowledging an alert does not close the case or stop its clock.</p>
      <div className="tabs" role="tablist">
        {FILTERS.map(([k, label]) => <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>)}
      </div>
      <MutationError error={error} />
      {list.isLoading ? <div className="card"><Loading rows={4} /></div> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.data.items.length === 0 ? (
        <div className="card"><Empty>Nothing here.</Empty></div>
      ) : (
        <ul className="notif-list" key={filter}>
          {list.data.items.map((n: any) => {
            const late = ['OVERDUE', 'ESCALATION'].includes(n.severity);
            return (
              <li key={n.id} className={`notif ${n.readAt ? 'read' : 'unread'} sev-${n.severity.toLowerCase()}`}>
                <div className="notif-stub">
                  <Status value={SEVERITY_TONE[n.severity]} label={SEVERITY_LABEL[n.severity]} />
                  <time className="notif-date" dateTime={n.createdAt}>{stampDate(n.createdAt)}<span>{slipTime(n.createdAt)}</span></time>
                  {n.appNo && <span className="notif-no">{n.appNo}</span>}
                </div>
                <div className="notif-body">
                  <div className="notif-head">
                    <strong>{n.title}</strong>
                    {!n.readAt && <span className="chip accent">New</span>}
                  </div>
                  <p className="small">{n.body}</p>
                  <div className="notif-foot">
                    <div className="row small">
                      {n.applicationId && <Link to={`/applications/${n.applicationId}`} onClick={() => !n.readAt && act(`/notifications/${n.id}/read`)}>Open {n.appNo}</Link>}
                      {n.email && <Status value={EMAIL_TONE[n.email.state] ?? 'IN_PROGRESS'} label={EMAIL_LABEL[n.email.state] ?? n.email.state} />}
                      {n.acknowledgedAt && <span className="ack"><b>AD</b>Acknowledged {formatDate(n.acknowledgedAt)}</span>}
                    </div>
                    <div className="row">
                      {!n.readAt && <button onClick={() => act(`/notifications/${n.id}/read`)}>Mark read</button>}
                      {late && !n.acknowledgedAt && <button className="primary" onClick={() => act(`/notifications/${n.id}/acknowledge`)}>Acknowledge</button>}
                    </div>
                  </div>
                </div>
                {n.acknowledgedAt && (
                  <span className="notif-mark">
                    <Postmark top="Acknowledged" date={stampDate(n.acknowledgedAt)} bottom="AD" size={64} land label={`Acknowledged ${formatDate(n.acknowledgedAt)}`} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
