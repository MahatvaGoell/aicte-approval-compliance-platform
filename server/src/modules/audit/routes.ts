import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../../db.js';
import { now } from '../../lib/clock.js';
import { requireCapability } from '../../http/context.js';
import { verifyChain } from './audit.js';
import { auditDetail, auditQuery, INTEGRITY_LIMITS, listAudit } from './service.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', async (req) => {
    const actor = requireCapability(req, 'AUDIT_VIEW');
    return listAudit(actor,auditQuery.parse(req.query));
  });

  app.get<{Params:{id:string}}>('/audit/:id',async req => {
    const actor = requireCapability(req,'AUDIT_VIEW');
    const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(req.params.id);
    return auditDetail(getPool(),actor,id);
  });

  app.post('/audit/verify', async (req) => {
    const actor = requireCapability(req, 'AUDIT_VIEW');
    const result = await verifyChain(getPool());
    const summary = actor.scopeAll ? result : {ok:result.ok,problem:result.problem};
    return {...summary,verifiedAt:now(),limits:INTEGRITY_LIMITS};
  });
}
