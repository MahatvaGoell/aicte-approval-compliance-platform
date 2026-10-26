import type { Db } from '../../db.js';
import { ForbiddenError, NotFoundError, q } from '../../db.js';
import type { Actor } from '../identity/permissions.js';
import { has, institutionScopeSql } from '../identity/permissions.js';

/** Runs aggregate a whole region, so institution/assigned-only grants cannot consume them. */
export function assertIntegrationAccess(actor:Actor,write=false) {
  if (!has(actor,write?'INTEGRATION_RESOLVE':'INTEGRATION_VIEW') || !has(actor,'APPLICATION_VIEW_SCOPE') || actor.role==='INSTITUTION_REP') throw new ForbiddenError('A regional integration grant is required');
}
export function integrationScopeSql(actor:Actor,params:unknown[],alias='r') {
  return `EXISTS (SELECT 1 FROM institutions i WHERE i.region_id = ${alias}.region_id AND ${institutionScopeSql(actor,params)})`;
}
export async function visibleRegions(db:Db,actor:Actor,regionId?:string) {
  const params:unknown[]=[];
  const scope=institutionScopeSql(actor,params);
  let filter='';if(regionId){params.push(regionId);filter=` AND r.id=$${params.length}`;}
  return q<{id:string;name:string}>(db,`SELECT r.id,r.name FROM regions r WHERE EXISTS (SELECT 1 FROM institutions i WHERE i.region_id=r.id AND ${scope})${filter} ORDER BY r.id`,params);
}
export async function requireIntegrationRegion(db:Db,actor:Actor,regionId:string) {
  if (!(await visibleRegions(db,actor,regionId)).length) throw new NotFoundError('Integration region not found');
}

export async function sourceInstitution(db:Db,actor:Actor,code:string,regionId:string) {
  const params:unknown[]=[code,regionId],scope=institutionScopeSql(actor,params);
  const visible=await q<{id:string}>(db,`SELECT i.id FROM institutions i WHERE i.aicte_permanent_id=$1 AND i.region_id=$2 AND ${scope}`,params);
  if(visible[0])return visible[0].id;
  // Scoped callers cannot distinguish an unknown code from a code outside their authorised region.
  if(!actor.scopeAll || (await q(db,'SELECT 1 FROM institutions WHERE aicte_permanent_id=$1',[code])).length) throw new NotFoundError('Source institution not found');
  return null; // Only all-region operators retain unmatched institution codes for reconciliation.
}
