import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool, NotFoundError, one, q, withTx } from '../../db.js';
import { config } from '../../config.js';
import { now } from '../../lib/clock.js';
import { actionContext, idempotencyKey, requireCapability } from '../../http/context.js';
import { withIdempotency } from '../../http/idempotency.js';
import { assertIntegrationAccess, integrationScopeSql, requireIntegrationRegion, visibleRegions } from './access.js';
import { MAPPING_VERSION, MOCK_NOTICE, SOURCE_SYSTEM, syncSchema } from './contract.js';
import { loadPortalFixture } from './fixtures.js';
import { syncImport } from './import.js';
import { listReconciliation, loadReconciliation, reconciliationDetail } from './reconciliation-read.js';
import { queueQuery, resolveSchema } from './reconciliation-schema.js';
import { resolveReconciliation } from './reconcile.js';

export async function integrationRoutes(app:FastifyInstance) {
  app.get('/integration/reconciliation',async req=>{
    const actor=requireCapability(req,'INTEGRATION_VIEW');return listReconciliation(actor,queueQuery.parse(req.query));
  });
  app.get<{Params:{id:string}}>('/integration/reconciliation/:id',async req=>{
    const actor=requireCapability(req,'INTEGRATION_VIEW');return reconciliationDetail(actor,z.string().uuid().parse(req.params.id));
  });
  app.post<{Params:{id:string}}>('/integration/reconciliation/:id/resolve',async req=>{
    const actor=requireCapability(req,'INTEGRATION_RESOLVE');assertIntegrationAccess(actor,true);
    if(!config.demoMode)throw new NotFoundError('Mock reconciliation is available only in demo mode');
    const id=z.string().uuid().parse(req.params.id),input=resolveSchema.parse(req.body);
    await loadReconciliation(getPool(),actor,id); // Scope must still hold when replaying a closed item.
    return withTx(async tx=>{
      const result=await withIdempotency(tx,actor.userId,idempotencyKey(req),`INTEGRATION_RESOLVE:${id}`,input,()=>resolveReconciliation(tx,actionContext(req),id,input));
      return {...result.result,replayed:result.replayed};
    });
  });
  app.post('/integration/sync',async req=>{
    const actor=requireCapability(req,'INTEGRATION_RESOLVE');assertIntegrationAccess(actor,true);
    if(!config.demoMode)throw new NotFoundError('The mock sync adapter is available only in demo mode');
    const input=syncSchema.parse(req.body);
    // Check current scope even on an idempotency replay of a previously authorised run.
    await requireIntegrationRegion(getPool(),actor,input.regionId);
    return withTx(async tx=>{
      const result=await withIdempotency(tx,actor.userId,idempotencyKey(req),'INTEGRATION_SYNC',input,async()=>
        syncImport(tx,actionContext(req),input,input.events??await loadPortalFixture(input.regionId)));
      return {...result.result,replayed:result.replayed};
    });
  });
  app.get('/integration/runs',async req=>{
    const actor=requireCapability(req,'INTEGRATION_VIEW');assertIntegrationAccess(actor);
    const filters=z.object({regionId:z.string().min(1).max(40).optional(),sourceSystem:z.literal(SOURCE_SYSTEM).default(SOURCE_SYSTEM),
      page:z.coerce.number().int().min(1).max(100_000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)}).strict().parse(req.query);
    return withTx(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const params:unknown[]=[filters.sourceSystem],where=['r.source_system=$1',integrationScopeSql(actor,params)];
      if(filters.regionId){params.push(filters.regionId);where.push(`r.region_id=$${params.length}`);}
      const from=`FROM integration_runs r WHERE ${where.join(' AND ')}`;
      const total=await one<{n:number}>(tx,`SELECT count(*)::int AS n ${from}`,params);
      const rows=await q(tx,`SELECT r.id,r.source_system AS "sourceSystem",r.region_id AS "regionId",r.mapping_version_id AS "mappingVersion",r.state,
        r.input_kind AS "inputKind",r.started_at AS "startedAt",r.completed_at AS "completedAt",r.total_count AS total,
        jsonb_build_object('accepted',r.accepted_count,'duplicate',r.duplicate_count,'invalid',r.invalid_count,'reconciliation',r.reconciliation_count) AS counts
        ${from} ORDER BY r.started_at DESC,r.id DESC LIMIT ${filters.pageSize} OFFSET ${(filters.page-1)*filters.pageSize}`,params);
      const regions=await visibleRegions(tx,actor,filters.regionId);
      const cursors=await q(tx,'SELECT region_id,row_version FROM integration_cursors WHERE source_system=$1 AND region_id=ANY($2::text[])',[SOURCE_SYSTEM,regions.map(r=>r.id)]);
      return {mock:true,connected:false,notice:MOCK_NOTICE,provenance:'DEMO_ASSUMPTION',mappingVersion:MAPPING_VERSION,
        total:total.n,page:filters.page,pageSize:filters.pageSize,rows,refreshedAt:now(),
        syncStates:regions.map(region=>({regionId:region.id,regionName:region.name,rowVersion:cursors.find(c=>c.region_id===region.id)?.row_version??0}))};
    });
  });
}
