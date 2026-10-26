import type { Db } from '../../db.js';
import { getPool, maybe, q, withTx } from '../../db.js';
import type { EmailAdapter } from './email.js';
import { EmailDeliveryError, retryDelayMs } from './email.js';
import { institutionUsers, notify, usersCoveringRegion } from './service.js';

// Background work that runs after commit: turning outbox events into notifications, and sending email.

const LEASE_MS = 60_000;

/** Converts pending outbox events into in-app notifications (and emails where the institution must act). */
export async function processOutbox(at: Date, batch = 100) {
  return withTx(async (tx) => {
    const events = await q(tx,
      `SELECT * FROM outbox_events WHERE state = 'PENDING' ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [batch]);
    let notified = 0;
    for (const e of events) {
      notified += await handleEvent(tx, e, at);
      await tx.query(`UPDATE outbox_events SET state = 'PROCESSED', processed_at = $2, attempts = attempts + 1 WHERE id = $1`, [e.id, at]);
    }
    return { events: events.length, notified };
  });
}

async function handleEvent(tx: Db, e: any, at: Date): Promise<number> {
  const p = e.payload ?? {};
  const appId: string | undefined = p.applicationId;
  const send = async (users: Array<{ id: string }>, title: string, body: string, email = false, kind = e.event_type) => {
    for (const u of users) await notify(tx, at, { userId: u.id, kind, title, body, applicationId: appId ?? null, sourceEventId: e.id, email });
    return users.length;
  };
  const app = appId ? await maybe<{ institution_id: string; region_id: string }>(tx, 'SELECT institution_id, region_id FROM applications WHERE id = $1', [appId]) : null;
  switch (e.event_type) {
    case 'EVC_VISIT_CONFIRMED':
    case 'EVC_VISIT_CANCELLED':
    case 'EVC_REPORT_SUBMITTED':
    case 'EVC_REPORT_ACCEPTED':
    case 'EVC_REPORT_RETURNED': {
      if (!app) return 0;
      const visit = await maybe(tx, 'SELECT * FROM evc_visits WHERE id = $1 AND application_id = $2', [p.visitId, appId]);
      if (!visit) return 0;
      if (e.event_type === 'EVC_VISIT_CONFIRMED' && visit.state !== 'CONFIRMED') return 0;
      const members = await q<{ id: string }>(tx, `SELECT DISTINCT u.id FROM visit_members m JOIN users u ON u.id = m.expert_user_id
        JOIN capability_grants g ON g.user_id = u.id AND g.committee_id = m.committee_id
        WHERE m.visit_id = $1 AND u.is_active AND g.role = 'COMMITTEE_MEMBER' AND g.revoked_at IS NULL
          AND g.valid_from <= $2 AND (g.valid_to IS NULL OR g.valid_to > $2)`, [visit.id, at]);
      const recipients = e.event_type === 'EVC_REPORT_SUBMITTED'
        ? await usersCoveringRegion(tx, 'REGIONAL_OFFICER', app.region_id, at)
        : e.event_type === 'EVC_REPORT_RETURNED' ? members
        : [...members, ...await institutionUsers(tx, app.institution_id, at)];
      const unique = [...new Map(recipients.map((u) => [u.id, u])).values()];
      return send(unique, e.event_type.replaceAll('_',' ').toLowerCase(), 'The EVC visit record changed. Open your authorised case workspace for the current schedule or review action. No report content is included.', true);
    }
    case 'STAGE_ASSIGNED':
      if (!p.assigneeUserId) return 0;
      return send([{ id: p.assigneeUserId }], `Assigned to you: ${p.stageName} for ${p.appNo}`, `You are now responsible for the ${p.stageName} stage of ${p.appNo}.`);
    case 'STAGE_QUEUED':
      if (!app) return 0;
      return send(await usersCoveringRegion(tx, 'REGIONAL_OFFICER', app.region_id, at), `Unassigned stage: ${p.stageName} for ${p.appNo}`,
        `No eligible owner was available for automatic assignment. Assign the stage.`);
    case 'CLASSIFICATION_REQUIRED':
      if (!app) return 0;
      return send(await usersCoveringRegion(tx, 'REGIONAL_OFFICER', app.region_id, at), `Classification needed: ${p.appNo}`,
        'No configured rule chose a route. An authorised officer must classify the application.');
    case 'CASE_RETURNED':
      if (!app) return 0;
      return send(await institutionUsers(tx, app.institution_id, at), `Action needed: ${p.appNo} was returned with ${p.findingCount} finding(s)`,
        'Open the case to read the findings and respond. The review continues once every finding is answered.', true);
    case 'DECISION_RECORDED':
      if (!app) return 0;
      return send(await institutionUsers(tx, app.institution_id, at), `Decision recorded on ${p.appNo}`,
        'A decision has been recorded on your application. Open the case to read it.', true);
    case 'APPEAL_FILED':
      if (!app) return 0;
      return send(await usersCoveringRegion(tx, 'REGIONAL_OFFICER', app.region_id, at), `Appeal filed: ${p.appNo}`, 'An appeal was filed against a recorded decision.');
    default:
      return 0;
  }
}

export interface DeliveryResult {
  claimed: number;
  accepted: number;
  retrying: number;
  bounced: number;
  dead: number;
  cancelled: number;
  duplicates: number;
}

/**
 * Sends due emails. A delivery is claimed with a lease (FOR UPDATE SKIP LOCKED). If a worker dies after the
 * claim, the lease expires and another worker picks it up (N02). If it dies after sending, the retry reuses
 * the same message id, and the adapter reports a duplicate instead of sending twice (N03). Exactly-once
 * delivery to an external provider is not claimed.
 */
export async function deliverEmails(adapter: EmailAdapter, at: Date, workerId: string, batch = 20): Promise<DeliveryResult> {
  const r: DeliveryResult = { claimed: 0, accepted: 0, retrying: 0, bounced: 0, dead: 0, cancelled: 0, duplicates: 0 };
  const claimed = await withTx((tx) => q(tx,
    `UPDATE deliveries SET state = 'SENDING', attempts = attempts + 1, lease_until = $2, locked_by = $3, updated_at = $1
      WHERE id IN (
        SELECT id FROM deliveries
         WHERE (state IN ('PENDING','RETRYING') AND next_attempt_at <= $1) OR (state = 'SENDING' AND lease_until < $1)
         ORDER BY next_attempt_at LIMIT $4 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [at, new Date(at.getTime() + LEASE_MS), workerId, batch]));
  r.claimed = claimed.length;
  for (const d of claimed) await sendOne(adapter, d, at, workerId, r);
  return r;
}

async function stillCurrent(db: Db, d: any) {
  if (!d.alert_event_id) return true;
  const row = await maybe(db,
    `SELECT dl.state, dl.generation, e.generation AS alert_generation FROM alert_events e JOIN deadlines dl ON dl.id = e.deadline_id WHERE e.id = $1`,
    [d.alert_event_id]);
  // Reminders for a closed clock, or for an older generation (extended or resumed), are stale.
  return !!row && row.state === 'ACTIVE' && row.generation === row.alert_generation;
}

async function sendOne(adapter: EmailAdapter, d: any, at: Date, workerId: string, r: DeliveryResult) {
  const finish = (state: string, sets: Record<string, unknown>, outcome: string, detail: string | null) => withTx(async (tx) => {
    const cols = Object.keys(sets);
    await tx.query(
      `UPDATE deliveries SET state = $2, lease_until = NULL, locked_by = NULL, updated_at = $3 ${cols.map((c, i) => `, ${c} = $${i + 4}`).join('')}
        WHERE id = $1 AND locked_by = $${cols.length + 4}`,
      [d.id, state, at, ...Object.values(sets), workerId],
    );
    await tx.query('INSERT INTO delivery_attempts (delivery_id, attempt_no, at, outcome, detail, worker_id) VALUES ($1,$2,$3,$4,$5,$6)', [d.id, d.attempts, at, outcome, detail, workerId]);
  });

  if (!(await stillCurrent(getPool(), d))) {
    r.cancelled++;
    return finish('CANCELLED', {}, 'CANCELLED_STALE', 'The deadline was closed or its due date changed before sending');
  }
  try {
    const res = await adapter.send({ messageId: d.message_id, to: d.to_address, subject: d.subject, text: d.body }, d.attempts);
    if (res.duplicate) r.duplicates++;
    r.accepted++;
    return finish('ACCEPTED', { provider_ref: res.providerRef, duplicate_suppressed: res.duplicate, last_error: null },
      res.duplicate ? 'ACCEPTED_DUPLICATE' : 'ACCEPTED', res.duplicate ? 'Provider already had this message id; no second message was sent' : null);
  } catch (err) {
    const permanent = err instanceof EmailDeliveryError ? err.permanent : false;
    const text = err instanceof Error ? err.message : String(err);
    if (permanent) {
      r.bounced++;
      return finish('BOUNCED', { last_error: text }, 'BOUNCED', text);
    }
    if (d.attempts >= d.max_attempts) {
      r.dead++;
      return finish('DEAD', { last_error: text }, 'FAILED_FINAL', text);
    }
    r.retrying++;
    return finish('RETRYING', { last_error: text, next_attempt_at: new Date(at.getTime() + retryDelayMs(d.attempts)) }, 'FAILED_RETRY', text);
  }
}
