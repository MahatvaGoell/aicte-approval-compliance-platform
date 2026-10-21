import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool, withTx } from '../../db.js';
import { actionContext, idempotencyKey, requireActor } from '../../http/context.js';
import { withIdempotency } from '../../http/idempotency.js';
import { executeCommand } from './commands.js';
import { createApplicationSchema, updateDraftSchema } from './forms.js';
import { createDraft, listApplications, submitApplication, updateDraft, withdrawDraft } from './service.js';
import { caseTimeline, caseView } from './view.js';

const listQuery = z.object({
  q: z.string().max(100).optional(),
  institutionId: z.string().uuid().optional(),
  regionId: z.string().max(40).optional(),
  categoryCode: z.string().max(60).optional(),
  stageKey: z.string().max(60).optional(),
  assigneeUserId: z.string().uuid().optional(),
  lifecycleState: z.string().max(40).optional(),
  decisionOutcome: z.string().max(40).optional(),
  submittedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  submittedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assignedToMe: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export async function applicationRoutes(app: FastifyInstance) {
  app.get('/applications', async (req) => {
    const actor = requireActor(req);
    return listApplications(getPool(), actor, listQuery.parse(req.query));
  });

  app.post('/applications', async (req) => {
    const actor = requireActor(req);
    const body = createApplicationSchema.parse(req.body);
    return withTx(async (tx) => {
      const { result } = await withIdempotency(tx, actor.userId, idempotencyKey(req), 'CREATE_APPLICATION', body, async () => {
        const created = await createDraft(tx, actionContext(req), body);
        return { id: created.id, appNo: created.app_no, rowVersion: created.row_version };
      });
      return result;
    });
  });

  app.get<{ Params: { id: string } }>('/applications/:id', async (req) => {
    const actor = requireActor(req);
    return caseView(getPool(), actor, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/applications/:id/timeline', async (req) => {
    const actor = requireActor(req);
    return caseTimeline(getPool(), actor, req.params.id);
  });

  app.put<{ Params: { id: string } }>('/applications/:id/draft', async (req) => {
    requireActor(req);
    const body = updateDraftSchema.parse(req.body);
    return withTx((tx) => updateDraft(tx, actionContext(req), req.params.id, body));
  });

  app.post<{ Params: { id: string } }>('/applications/:id/submit', async (req) => {
    const actor = requireActor(req);
    const body = z.object({ expectedVersion: z.number().int() }).parse(req.body);
    return withTx(async (tx) => {
      const { result, replayed } = await withIdempotency(tx, actor.userId, idempotencyKey(req), `SUBMIT:${req.params.id}`, body, () =>
        submitApplication(tx, actionContext(req), req.params.id, body.expectedVersion),
      );
      return { ...result, replayed };
    });
  });

  app.post<{ Params: { id: string } }>('/applications/:id/withdraw', async (req) => {
    const actor = requireActor(req);
    const body = z.object({ expectedVersion: z.number().int(), reason: z.string().trim().min(5).max(500) }).parse(req.body);
    return withTx(async (tx) => {
      const { result } = await withIdempotency(tx, actor.userId, idempotencyKey(req), `WITHDRAW:${req.params.id}`, body, () =>
        withdrawDraft(tx, actionContext(req), req.params.id, body.expectedVersion, body.reason),
      );
      return result;
    });
  });

  // Every case transition goes through this one endpoint. There is deliberately no generic status update.
  app.post<{ Params: { id: string } }>('/applications/:id/commands', async (req) => {
    const actor = requireActor(req);
    const body = z
      .object({ command: z.string().min(1).max(60), expectedVersion: z.number().int() })
      .passthrough()
      .parse(req.body);
    return withTx(async (tx) => {
      const { result, replayed } = await withIdempotency(tx, actor.userId, idempotencyKey(req), `COMMAND:${req.params.id}`, body, () =>
        executeCommand(tx, actionContext(req), req.params.id, body),
      );
      return { ...result, replayed };
    });
  });
}
