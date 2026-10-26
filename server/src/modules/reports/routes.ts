import type { FastifyInstance } from 'fastify';
import { getPool, withTx } from '../../db.js';
import { actionContext, requireActor } from '../../http/context.js';
import { recordAudit } from '../audit/audit.js';
import { dashboardQuery, reportQuery } from './filters.js';
import { assertDashboardAccess, dashboard, exportReportCsv, reportCatalogue, requireReport, runReport } from './service.js';

export async function reportRoutes(app: FastifyInstance) {
  app.get('/reports', async (req) => ({ reports: reportCatalogue(requireActor(req)) }));

  // Unknown names and reports outside the active role return 404, so report names cannot be probed.
  app.get<{ Params: { name: string } }>('/reports/:name', async (req) => {
    const actor = requireActor(req);
    const def = requireReport(actor, req.params.name);
    const { page, pageSize, ...filters } = reportQuery.parse(req.query);
    return runReport(getPool(), actor, def, filters, page, pageSize);
  });

  // Same filters and scope as the JSON report. Every export is recorded: who took which records out, and how many.
  app.get<{ Params: { name: string } }>('/reports/:name/csv', async (req, reply) => {
    const actor = requireActor(req);
    const def = requireReport(actor, req.params.name);
    const { page: _page, pageSize: _pageSize, ...filters } = reportQuery.parse(req.query);
    const out = await withTx(async (tx) => {
      const exported = await exportReportCsv(tx, actor, def, filters);
      await recordAudit(tx, actionContext(req), {
        entityType: 'report', entityId: def.name, action: 'REPORT_EXPORTED',
        after: { report: def.name, filters, rowCount: exported.rowCount }, institutionId: actor.institutionId,
      });
      return exported;
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${out.filename}"`)
      .send(out.csv);
  });

  app.get<{ Params: { view: string } }>('/dashboards/:view', async (req) => {
    const actor = requireActor(req);
    const view = assertDashboardAccess(actor, req.params.view);
    return dashboard(getPool(), actor, view, dashboardQuery.parse(req.query));
  });
}
