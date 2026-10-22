import type { Db } from '../../db.js';
import { maybe, q } from '../../db.js';
import { config } from '../../config.js';

// In-app notifications and the email delivery intent written with them (same transaction).
// External messages never carry attachments or sensitive case details: they link to the case instead.

export type Severity = 'INFO' | 'REMINDER' | 'OVERDUE' | 'ESCALATION';

export interface NewNotification {
  userId: string;
  kind: string;
  severity?: Severity;
  title: string;
  body: string;
  applicationId?: string | null;
  alertEventId?: string | null;
  sourceEventId?: number | null;
  email?: { alertEventId?: string | null } | boolean;
}

export function caseLink(applicationId: string) {
  return `${config.appBaseUrl}/applications/${applicationId}`;
}

/** Creates a notification (idempotent per user + source outbox event) and, if asked, an email delivery. */
export async function notify(tx: Db, at: Date, n: NewNotification) {
  const row = await maybe<{ id: string }>(
    tx,
    `INSERT INTO notifications (user_id, kind, severity, title, body, application_id, alert_event_id, source_event_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_id, source_event_id) DO NOTHING RETURNING id`,
    [n.userId, n.kind, n.severity ?? 'INFO', n.title, n.body, n.applicationId ?? null, n.alertEventId ?? null, n.sourceEventId ?? null, at],
  );
  if (!row) return null;
  if (n.email) {
    const user = await maybe<{ email: string }>(tx, 'SELECT email FROM users WHERE id = $1 AND is_active', [n.userId]);
    if (user) {
      const link = n.applicationId ? `\n\nOpen the case: ${caseLink(n.applicationId)}` : '';
      await tx.query(
        `INSERT INTO deliveries (notification_id, alert_event_id, to_address, subject, body, message_id, state, next_attempt_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$7,$7)`,
        [row.id, typeof n.email === 'object' ? n.email.alertEventId ?? null : null, user.email, n.title.replace(/[\r\n]+/g, ' ').slice(0, 200),
          `${n.body}${link}\n\nThis is an automated message from a demonstration system. All data is synthetic.`,
          `n-${row.id}`, at],
      );
    }
  }
  return row.id;
}

/** Users holding an active grant of `role` that covers `regionId` (scope-all grants included). */
export async function usersCoveringRegion(db: Db, role: string, regionId: string, at: Date) {
  return q<{ id: string; name: string }>(
    db,
    `SELECT DISTINCT u.id, u.name FROM users u JOIN capability_grants g ON g.user_id = u.id
      WHERE u.is_active AND g.role = $1 AND g.revoked_at IS NULL AND g.valid_from <= $3 AND (g.valid_to IS NULL OR g.valid_to > $3)
        AND (g.scope_all OR $2 = ANY(g.region_ids))`,
    [role, regionId, at],
  );
}

export async function institutionUsers(db: Db, institutionId: string, at: Date) {
  return q<{ id: string; name: string }>(
    db,
    `SELECT DISTINCT u.id, u.name FROM users u JOIN capability_grants g ON g.user_id = u.id
      WHERE u.is_active AND g.role = 'INSTITUTION_REP' AND g.institution_id = $1 AND g.revoked_at IS NULL
        AND g.valid_from <= $2 AND (g.valid_to IS NULL OR g.valid_to > $2)`,
    [institutionId, at],
  );
}
