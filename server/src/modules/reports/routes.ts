import type { FastifyInstance } from 'fastify';
import { getPool } from '../../db.js';
import { requireActor } from '../../http/context.js';
import { dashboardQuery, reportQuery } from './filters.js';
import { assertDashboardAccess, dashboard, reportCatalogue, requireReport, runReport } from './service.js';

export async function reportRoutes(app: FastifyInstance) {
  app.get('/reports', async (req) => ({ reports: reportCatalogue(requireActor(req)) }));

  // Unknown names and reports outside the active role return 404, so report names cannot be probed.
  app.get<{ Params: { name: string } }>('/reports/:name', async (req) => {
    const actor = requireActor(req);
    const def = requireReport(actor, req.params.name);
    const { page, pageSize, ...filters } = reportQuery.parse(req.query);
    return runReport(getPool(), actor, def, filters, page, pageSize);
  });

  app.get<{ Params: { view: string } }>('/dashboards/:view', async (req) => {
    const actor = requireActor(req);
    const view = assertDashboardAccess(actor, req.params.view);
    return dashboard(getPool(), actor, view, dashboardQuery.parse(req.query));
  });
}
