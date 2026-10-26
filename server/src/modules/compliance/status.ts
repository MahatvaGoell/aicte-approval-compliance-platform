import type { Db } from '../../db.js';
import { one } from '../../db.js';
import { now } from '../../lib/clock.js';

/** Read-time status keeps elapsed submission deadlines consistent in case and queue views. */
export async function complianceStatus(db: Db, applicationId: string) {
  const x = await one(db, `SELECT
    (SELECT COALESCE(sum(jsonb_array_length(conditions)),0)::int FROM decisions WHERE application_id = $1 AND outcome IN ('APPROVED','APPROVED_WITH_CONDITIONS')) AS conditions,
    count(o.id)::int AS tracked, count(o.id) FILTER (WHERE o.state IN ('FULFILLED','CLOSED_WITH_AUTHORISED_REASON'))::int AS closed,
    count(o.id) FILTER (WHERE o.state = 'OPEN' AND EXISTS (SELECT 1 FROM deadlines d WHERE d.subject_id = o.id AND d.clock_type = 'OBLIGATION_SUBMISSION' AND d.state = 'ACTIVE' AND d.current_due_at <= $2))::int AS overdue
    FROM obligations o WHERE application_id = $1`, [applicationId,now()]);
  return x.conditions === 0 && x.tracked === 0 ? 'NONE' : x.overdue ? 'OVERDUE' : x.tracked >= x.conditions && x.closed === x.tracked ? 'ALL_FULFILLED' : 'OPEN';
}
