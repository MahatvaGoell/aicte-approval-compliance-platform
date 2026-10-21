import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool, withTx } from '../../db.js';
import { actionContext, idempotencyKey, requireCapability } from '../../http/context.js';
import { withIdempotency } from '../../http/idempotency.js';
import { createDraft, diffVersions, listSources, listVersions, publishVersion, updateDraft, versionDetail } from './admin.js';
import { validatePolicy } from './schema.js';

export async function policyRoutes(app: FastifyInstance) {
  app.get('/policy/versions', async (req) => {
    requireCapability(req, 'POLICY_VIEW');
    return listVersions(getPool());
  });

  app.get<{ Params: { id: string } }>('/policy/versions/:id', async (req) => {
    requireCapability(req, 'POLICY_VIEW');
    return versionDetail(getPool(), req.params.id);
  });

  app.post('/policy/versions', async (req) => {
    const actor = requireCapability(req, 'POLICY_DRAFT');
    const body = z.object({ basedOnId: z.string().uuid(), label: z.string().trim().min(3).max(120) }).parse(req.body);
    return withTx(async (tx) => {
      const { result } = await withIdempotency(tx, actor.userId, idempotencyKey(req), 'POLICY_DRAFT_CREATE', body, () =>
        createDraft(tx, actionContext(req), body.basedOnId, body.label),
      );
      return result;
    });
  });

  app.put<{ Params: { id: string } }>('/policy/versions/:id', async (req) => {
    requireCapability(req, 'POLICY_DRAFT');
    const body = z.object({ document: z.unknown(), label: z.string().trim().min(3).max(120).optional(), expectedVersion: z.number().int() }).parse(req.body);
    return withTx((tx) => updateDraft(tx, actionContext(req), req.params.id, body));
  });

  // Validates a document without saving it (used by the editor while typing).
  app.post('/policy/validate', async (req) => {
    requireCapability(req, 'POLICY_VIEW');
    const body = z.object({ document: z.unknown() }).parse(req.body);
    return { issues: validatePolicy(body.document).issues };
  });

  app.post<{ Params: { id: string } }>('/policy/versions/:id/publish', async (req) => {
    const actor = requireCapability(req, 'POLICY_PUBLISH');
    const body = z
      .object({
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
        changeNote: z.string().trim().min(10).max(2000),
        expectedVersion: z.number().int(),
      })
      .parse(req.body);
    return withTx(async (tx) => {
      const { result } = await withIdempotency(tx, actor.userId, idempotencyKey(req), `POLICY_PUBLISH:${req.params.id}`, body, () =>
        publishVersion(tx, actionContext(req), req.params.id, body),
      );
      return result;
    });
  });

  app.get('/policy/diff', async (req) => {
    requireCapability(req, 'POLICY_VIEW');
    const query = z.object({ from: z.string().uuid(), to: z.string().uuid() }).parse(req.query);
    return diffVersions(getPool(), query.from, query.to);
  });

  app.get('/policy/sources', async (req) => {
    requireCapability(req, 'POLICY_VIEW');
    return listSources(getPool());
  });
}
