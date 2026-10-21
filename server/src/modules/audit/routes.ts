import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool, q } from '../../db.js';
import { requireCapability } from '../../http/context.js';
import { verifyChain } from './audit.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', async (req) => {
    const actor = requireCapability(req, 'AUDIT_VIEW');
    const f = z
      .object({
        applicationId: z.string().uuid().optional(),
        action: z.string().max(60).optional(),
        actorUserId: z.string().uuid().optional(),
        beforeId: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    // Auditors see events for applications inside their scope plus system-level events.
    if (!actor.scopeAll) {
      params.push(actor.regionIds);
      where.push(`(e.application_id IS NULL OR EXISTS (SELECT 1 FROM applications a WHERE a.id = e.application_id AND a.region_id = ANY($${params.length}::text[])))`);
    }
    if (f.applicationId) { params.push(f.applicationId); where.push(`e.application_id = $${params.length}`); }
    if (f.action) { params.push(f.action); where.push(`e.action = $${params.length}`); }
    if (f.actorUserId) { params.push(f.actorUserId); where.push(`e.actor_user_id = $${params.length}`); }
    if (f.beforeId) { params.push(f.beforeId); where.push(`e.id < $${params.length}`); }
    return q(
      getPool(),
      `SELECT e.id, e.at, e.recorded_at, e.actor_role, u.name AS actor_name, e.entity_type, e.entity_id, e.action, e.reason,
              e.rule_ref, e.application_id, a.app_no, e.correlation_id, e.before_state, e.after_state, e.hash, e.prev_hash
         FROM audit_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
         LEFT JOIN applications a ON a.id = e.application_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY e.id DESC LIMIT ${f.limit}`,
      params,
    );
  });

  app.post('/audit/verify', async (req) => {
    requireCapability(req, 'AUDIT_VIEW');
    return verifyChain(getPool());
  });
}
