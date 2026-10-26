import type { Db } from '../../db.js';
import { NotFoundError, one, q, withTx } from '../../db.js';
import { now } from '../../lib/clock.js';
import type { Actor } from '../identity/permissions.js';
import { has, institutionScopeSql } from '../identity/permissions.js';
import { assertIntegrationAccess, integrationScopeSql } from './access.js';
import { identitySchema, mappingSchema, MOCK_NOTICE } from './contract.js';
import type { QueueQuery } from './reconciliation-schema.js';

const FROM=`FROM integration_reconciliation queue JOIN integration_raw_events raw ON raw.id=queue.raw_event_id
  JOIN integration_runs r ON r.id=raw.run_id JOIN integration_run_items item ON item.raw_event_id=raw.id`;
const SUMMARY=`queue.id,queue.state,queue.reason_code AS "reasonCode",queue.row_version AS "rowVersion",queue.created_at AS "createdAt",
  r.id AS "runId",r.region_id AS "regionId",r.source_system AS "sourceSystem",r.mapping_version_id AS "mappingVersion",raw.ordinal,
  CASE WHEN jsonb_typeof(raw.payload->'externalId')='string' THEN raw.payload->>'externalId' END AS "externalId",
  CASE WHEN jsonb_typeof(raw.payload->'eventId')='string' THEN raw.payload->>'eventId' END AS "eventId",raw.payload->>'revision' AS revision`;

export async function listReconciliation(actor:Actor,f:QueueQuery) {
  assertIntegrationAccess(actor);
  return withTx(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const params:unknown[]=[],where=[integrationScopeSql(actor,params)];
    const add=(sql:string,value:unknown)=>{params.push(value);where.push(sql.replace('?',`$${params.length}`));};
    if(f.regionId)add('r.region_id=?',f.regionId);if(f.runId)add('r.id=?',f.runId);
    if(f.state!=='ALL')add('queue.state=?',f.state);if(f.reasonCode)add('queue.reason_code=?',f.reasonCode);
    const filtered=`${FROM} WHERE ${where.join(' AND ')}`;
    const total=await one<{n:number}>(tx,`SELECT count(*)::int AS n ${filtered}`,params);
    const rows=await q(tx,`SELECT ${SUMMARY},attempt.outcome AS "lastOutcome",attempt.reason_code AS "lastReasonCode"
      ${FROM} LEFT JOIN integration_resolution_attempts attempt ON attempt.id=queue.last_attempt_id WHERE ${where.join(' AND ')}
      ORDER BY queue.created_at,queue.id LIMIT ${f.pageSize} OFFSET ${(f.page-1)*f.pageSize}`,params);
    return {mock:true,connected:false,notice:MOCK_NOTICE,provenance:'DEMO_ASSUMPTION',total:total.n,page:f.page,pageSize:f.pageSize,rows,refreshedAt:now()};
  });
}

/** Reused before idempotency replay and inside the write transaction. Outside current scope = 404. */
export async function loadReconciliation(db:Db,actor:Actor,id:string,forUpdate=false) {
  const params:unknown[]=[id],scope=integrationScopeSql(actor,params);
  const rows=await q(db,`SELECT queue.*,raw.payload,raw.payload_sha256,raw.institution_id,raw.run_id,raw.ordinal,raw.received_at,
    r.region_id,r.source_system,r.mapping_version_id,r.total_count,r.accepted_count,r.duplicate_count,r.invalid_count,r.reconciliation_count,
    item.canonical_event_id,item.outcome AS import_outcome,item.details AS validation_details
    ${FROM} WHERE queue.id=$1 AND ${scope}${forUpdate?' FOR UPDATE OF queue':''}`,params);
  if(!rows.length)throw new NotFoundError('Reconciliation item not found');return rows[0];
}

export async function reconciliationDetail(actor:Actor,id:string) {
  assertIntegrationAccess(actor);
  return withTx(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row=await loadReconciliation(tx,actor,id),identity=identitySchema.safeParse(row.payload);
    const params:unknown[]=[row.source_system,row.region_id,identity.success?identity.data.externalId:null];
    const scope=institutionScopeSql(actor,params);
    const mirror=(await q(tx,`SELECT m.id,m.source_title AS "sourceTitle",m.source_status AS "sourceStatus",m.latest_revision AS revision,
      m.source_updated_at AS "sourceUpdatedAt",m.row_version AS "rowVersion",m.latest_resolution_id AS "latestResolutionId",m.mapping_version_id AS "mappingVersion",
      i.aicte_permanent_id AS "institutionCode" FROM integration_mirrors m JOIN institutions i ON i.id=m.institution_id
      WHERE m.source_system=$1 AND m.region_id=$2 AND m.external_id=$3 AND ${scope}`,params))[0]??null;
    const mapping=await one(tx,'SELECT document FROM integration_mapping_versions WHERE id=$1 AND source_system=$2',[row.mapping_version_id,row.source_system]);
    const codes=mappingSchema.parse(mapping.document).statusCodes;
    const cursor=await one(tx,'SELECT row_version FROM integration_cursors WHERE source_system=$1 AND region_id=$2',[row.source_system,row.region_id]);
    const institutionsParams:unknown[]=[row.region_id];const instScope=institutionScopeSql(actor,institutionsParams);
    const institutions=await q(tx,`SELECT i.aicte_permanent_id AS code,i.name FROM institutions i WHERE i.region_id=$1 AND ${instScope} ORDER BY i.name`,institutionsParams);
    const attempts=await q(tx,`SELECT attempt.id,attempt.action,attempt.outcome,attempt.reason,attempt.reason_code AS "reasonCode",attempt.validation_details AS details,
      attempt.corrections,attempt.evaluated_record AS "evaluatedRecord",attempt.mirror_before AS "mirrorBefore",attempt.mirror_after AS "mirrorAfter",
      attempt.recorded_at AS "recordedAt",u.name AS "recordedBy",attempt.expected_version AS "itemVersion",attempt.cursor_version AS "cursorVersion"
      FROM integration_resolution_attempts attempt JOIN users u ON u.id=attempt.recorded_by WHERE attempt.reconciliation_id=$1 ORDER BY attempt.expected_version`,[row.id]);
    return {mock:true,connected:false,notice:MOCK_NOTICE,provenance:'DEMO_ASSUMPTION',
      item:{id:row.id,state:row.state,reasonCode:row.reason_code,rowVersion:row.row_version,cursorVersion:cursor.row_version,createdAt:row.created_at,
        resolvedAt:row.resolved_at,resolutionReason:row.resolution_reason,regionId:row.region_id,runId:row.run_id,sourceSystem:row.source_system,mappingVersion:row.mapping_version_id,
        externalId:identity.success?identity.data.externalId:null,eventId:identity.success?identity.data.eventId:null,revision:identity.success?identity.data.revision:null,
        canResolve:has(actor,'INTEGRATION_RESOLVE')&&row.state==='OPEN',canCorrect:!!row.canonical_event_id&&identity.success&&['INVALID_RECORD','UNKNOWN_CODE','SOURCE_TIME_REGRESSION','INSTITUTION_UNMAPPED'].includes(row.reason_code),
        canCorrectInstitution:!row.institution_id},
      raw:{id:row.raw_event_id,payload:row.payload,sha256:row.payload_sha256,receivedAt:row.received_at,ordinal:row.ordinal,importOutcome:row.import_outcome,validationDetails:row.validation_details},
      runCounts:{total:row.total_count,accepted:row.accepted_count,duplicate:row.duplicate_count,invalid:row.invalid_count,reconciliation:row.reconciliation_count},
      currentMirror:mirror,statusCodes:Object.entries(codes).map(([code,mirrorStatus])=>({code,mirrorStatus})),institutionOptions:institutions,attempts};
  });
}
