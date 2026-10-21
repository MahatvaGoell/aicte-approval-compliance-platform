import type { FastifyInstance } from 'fastify';
import { getPool, NotFoundError, q } from '../../db.js';
import { requireActor } from '../../http/context.js';
import { institutionScopeSql } from '../identity/permissions.js';
import { activePolicy } from '../policy/service.js';

export async function referenceRoutes(app: FastifyInstance) {
  app.get('/reference', async (req) => {
    requireActor(req);
    const db = getPool();
    const policy = await activePolicy(db);
    const regions = await q(db, 'SELECT id, name, is_synthetic FROM regions ORDER BY id');
    const cycles = await q(db, 'SELECT code, starts_on, ends_on FROM cycles ORDER BY code');
    return {
      regions,
      cycles,
      activePolicy: {
        id: policy.id, versionNo: policy.versionNo, label: policy.label,
        categories: policy.doc.categories,
        stages: Object.entries(policy.doc.stages).map(([key, s]) => ({ key, name: s.name, kind: s.kind })),
        routes: Object.entries(policy.doc.routes).map(([key, r]) => ({ key, name: r.name })),
      },
    };
  });

  app.get('/institutions', async (req) => {
    const actor = requireActor(req);
    const params: unknown[] = [];
    const scope = institutionScopeSql(actor, params);
    return q(
      getPool(),
      `SELECT i.id, i.name, i.aicte_permanent_id, i.district, i.state, i.region_id, i.institution_type, i.is_synthetic
         FROM institutions i WHERE ${scope} ORDER BY i.name`,
      params,
    );
  });

  app.get<{ Params: { id: string } }>('/institutions/:id', async (req) => {
    const actor = requireActor(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new NotFoundError('Institution not found');
    const params: unknown[] = [req.params.id];
    const scope = institutionScopeSql(actor, params);
    const rows = await q(getPool(), `SELECT i.* FROM institutions i WHERE i.id = $1 AND ${scope}`, params);
    if (!rows.length) throw new NotFoundError('Institution not found');
    const contacts = await q(getPool(), 'SELECT name, designation, email, phone FROM institution_contacts WHERE institution_id = $1 AND is_authorised', [req.params.id]);
    return { ...rows[0], contacts };
  });
}
