import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError, getPool, maybe, q, withTx } from '../../db.js';
import { requireActor } from '../../http/context.js';
import { now } from '../../lib/clock.js';

// The signed-in user's own notification centre. Reading or acknowledging an alert never closes the case
// or the deadline behind it.

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications', async (req) => {
    const actor = requireActor(req);
    const f = z.object({
      filter: z.enum(['all', 'unread', 'escalations', 'deadlines']).default('all'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);
    const where = ['n.user_id = $1'];
    if (f.filter === 'unread') where.push('n.read_at IS NULL');
    if (f.filter === 'escalations') where.push(`n.severity IN ('OVERDUE','ESCALATION')`);
    if (f.filter === 'deadlines') where.push(`n.kind LIKE 'DEADLINE_%'`);
    const rows = await q(
      getPool(),
      `SELECT n.id, n.kind, n.severity, n.title, n.body, n.application_id, a.app_no, n.created_at, n.read_at, n.acknowledged_at,
              d.state AS delivery_state, d.attempts AS delivery_attempts, d.last_error AS delivery_error
         FROM notifications n
         LEFT JOIN applications a ON a.id = n.application_id
         LEFT JOIN LATERAL (SELECT state, attempts, last_error FROM deliveries WHERE notification_id = n.id ORDER BY created_at DESC LIMIT 1) d ON true
        WHERE ${where.join(' AND ')}
        ORDER BY n.created_at DESC, n.id LIMIT ${f.limit}`,
      [actor.userId],
    );
    const counts = await q(
      getPool(),
      `SELECT count(*) FILTER (WHERE read_at IS NULL)::int AS unread,
              count(*) FILTER (WHERE acknowledged_at IS NULL AND severity IN ('OVERDUE','ESCALATION'))::int AS unacknowledged
         FROM notifications WHERE user_id = $1`,
      [actor.userId],
    );
    return {
      unreadCount: counts[0].unread,
      unacknowledgedEscalations: counts[0].unacknowledged,
      items: rows.map((r) => ({
        id: r.id, kind: r.kind, severity: r.severity, title: r.title, body: r.body, applicationId: r.application_id, appNo: r.app_no,
        createdAt: r.created_at, readAt: r.read_at, acknowledgedAt: r.acknowledged_at,
        email: r.delivery_state ? { state: r.delivery_state, attempts: r.delivery_attempts, error: r.delivery_error } : null,
      })),
    };
  });

  app.get('/notifications/count', async (req) => {
    const actor = requireActor(req);
    const r = await q(getPool(), 'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [actor.userId]);
    return { unreadCount: r[0].n };
  });

  const mark = (column: 'read_at' | 'acknowledged_at') => async (req: any) => {
    const actor = requireActor(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new NotFoundError('Notification not found');
    return withTx(async (tx) => {
      // Acknowledging also marks as read.
      const extra = column === 'acknowledged_at' ? ', read_at = coalesce(read_at, $3)' : '';
      const row = await maybe(tx,
        `UPDATE notifications SET ${column} = coalesce(${column}, $3)${extra} WHERE id = $1 AND user_id = $2 RETURNING id, read_at, acknowledged_at`,
        [req.params.id, actor.userId, now()]);
      if (!row) throw new NotFoundError('Notification not found');
      return { id: row.id, readAt: row.read_at, acknowledgedAt: row.acknowledged_at };
    });
  };
  app.post('/notifications/:id/read', mark('read_at'));
  app.post('/notifications/:id/acknowledge', mark('acknowledged_at'));

  app.post('/notifications/read-all', async (req) => {
    const actor = requireActor(req);
    const r = await getPool().query('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL', [actor.userId, now()]);
    return { updated: r.rowCount };
  });
}
