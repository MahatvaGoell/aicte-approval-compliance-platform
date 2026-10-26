import crypto from 'node:crypto';
import type { Db } from '../../db.js';
import { AppError, ConflictError, NotFoundError, one, q } from '../../db.js';
import { canonicalJson, sha256 } from '../../lib/crypto.js';
import { recordAudit, type ActionContext } from '../audit/audit.js';
import { emitEvent } from '../outbox/outbox.js';
import { assertIntegrationAccess, sourceInstitution } from './access.js';
import { identitySchema, mappingSchema, MOCK_NOTICE, sourceRecordSchema } from './contract.js';
import { IMPORT_LOCK } from './import.js';
import { applySourceMirror } from './mirror.js';
import { loadReconciliation } from './reconciliation-read.js';
import type { ResolveInput } from './reconciliation-schema.js';

const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
interface Evaluation {outcome:'APPLIED'|'STILL_BLOCKED';reasonCode:string|null;details:unknown;before:unknown;after:unknown;canonicalId:string|null}

async function evaluate(tx:Db,ctx:ActionContext,row:any,record:unknown,attemptId:string):Promise<Evaluation> {
  const blocked=(reasonCode:string,details:unknown=[]):Evaluation=>({outcome:'STILL_BLOCKED',reasonCode,details,before:null,after:null,canonicalId:row.canonical_event_id});
  // Corrections can never invent/change source identity or replace a conflicting canonical event.
  const identity=identitySchema.safeParse(row.payload);
  if(!identity.success)return blocked('INVALID_IDENTITY',identity.error.issues.map(x=>({field:x.path.join('.'),message:x.message})));
  const canonical=await q(tx,`SELECT id FROM integration_source_events WHERE id=$1 AND raw_event_id=$2 AND source_system=$3 AND region_id=$4
    AND external_id=$5 AND event_id=$6 AND revision=$7`,[row.canonical_event_id,row.raw_event_id,row.source_system,row.region_id,identity.data.externalId,identity.data.eventId,identity.data.revision]);
  if(!canonical.length)return blocked('IDENTITY_CONFLICT');
  const parsed=sourceRecordSchema.safeParse(record);
  if(!parsed.success)return blocked('INVALID_RECORD',parsed.error.issues.map(x=>({field:x.path.join('.'),message:x.message})));
  let institutionId:string|null;
  try {institutionId=await sourceInstitution(tx,ctx.actor!,parsed.data.institutionCode,row.region_id);}
  catch(error) {
    if(error instanceof NotFoundError&&!row.institution_id&&parsed.data.institutionCode===object(row.payload).institutionCode)return blocked('INSTITUTION_UNMAPPED');
    throw error;
  }
  if(!institutionId)return blocked('INSTITUTION_UNMAPPED');
  if(row.institution_id&&institutionId!==row.institution_id)return blocked('INSTITUTION_BINDING_CONFLICT');
  const mapping=await one(tx,'SELECT document FROM integration_mapping_versions WHERE id=$1 AND source_system=$2',[row.mapping_version_id,row.source_system]);
  const {statusCodes}=mappingSchema.parse(mapping.document);
  const result=await applySourceMirror(tx,{sourceSystem:row.source_system,regionId:row.region_id,institutionId,mappingVersion:row.mapping_version_id,
    canonicalId:row.canonical_event_id,record:parsed.data,statusCodes,at:ctx.at,resolutionId:attemptId});
  return {outcome:result.applied?'APPLIED':'STILL_BLOCKED',reasonCode:result.reasonCode,details:[],before:result.before,after:result.after,canonicalId:row.canonical_event_id};
}

/** Caller wraps this in withTx + withIdempotency. Both scope and versions are checked under the source lock. */
export async function resolveReconciliation(tx:Db,ctx:ActionContext,id:string,input:ResolveInput) {
  assertIntegrationAccess(ctx.actor!,true);
  await tx.query('SELECT pg_advisory_xact_lock($1)',[IMPORT_LOCK]);
  const row=await loadReconciliation(tx,ctx.actor!,id,true);
  if(row.row_version!==input.expectedVersion)throw new ConflictError('This queue item changed. Refresh before reviewing.',{code:'STALE_VERSION',currentVersion:row.row_version});
  if(row.state!=='OPEN')throw new ConflictError('This reconciliation item is already closed');
  const cursor=await one(tx,'SELECT row_version FROM integration_cursors WHERE source_system=$1 AND region_id=$2 FOR UPDATE',[row.source_system,row.region_id]);
  if(cursor.row_version!==input.expectedCursorVersion)throw new ConflictError('An import or another review changed this region. Refresh before reviewing.',{code:'STALE_CURSOR',currentVersion:cursor.row_version});
  if(sha256(canonicalJson(row.payload))!==row.payload_sha256)throw new AppError(503,'SOURCE_INTEGRITY_FAILED','The retained source payload failed its integrity check');
  const attemptId=crypto.randomUUID();
  let evaluated:unknown=row.payload;
  const corrections=input.action==='CORRECT_AND_RETRY'?input.corrections:{};
  if(input.action==='CORRECT_AND_RETRY') {
    const corrections=input.corrections;
    const original=object(row.payload),fields={...object(original.fields)};
    if(corrections.title!==undefined)fields.title=corrections.title;
    if(corrections.statusCode!==undefined)fields.statusCode=corrections.statusCode;
    evaluated={...original,fields,...(corrections.sourceUpdatedAt!==undefined?{sourceUpdatedAt:corrections.sourceUpdatedAt}:{}),
      ...(corrections.institutionCode!==undefined?{institutionCode:corrections.institutionCode}:{})};
  }
  const result=input.action==='DISMISS'?{outcome:'DISMISSED' as const,reasonCode:null,details:[],before:null,after:null,canonicalId:row.canonical_event_id}:await evaluate(tx,ctx,row,evaluated,attemptId);
  const state=result.outcome==='APPLIED'?'RESOLVED':result.outcome==='DISMISSED'?'DISMISSED':'OPEN';
  await tx.query(`INSERT INTO integration_resolution_attempts(id,reconciliation_id,action,outcome,expected_version,cursor_version,reason,
    evaluated_record,corrections,canonical_event_id,mapping_version_id,reason_code,validation_details,mirror_before,mirror_after,recorded_by,recorded_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [attemptId,row.id,input.action,result.outcome,row.row_version,cursor.row_version,input.reason,JSON.stringify(evaluated),JSON.stringify(corrections),result.canonicalId,row.mapping_version_id,
      result.reasonCode,JSON.stringify(result.details),JSON.stringify(result.before),JSON.stringify(result.after),ctx.actor!.userId,ctx.at]);
  await tx.query(`UPDATE integration_reconciliation SET state=$2,row_version=row_version+1,last_attempt_id=$3,
    resolved_at=$4,resolved_by=$5,resolution_reason=$6 WHERE id=$1`,[id,state,attemptId,state==='OPEN'?null:ctx.at,state==='OPEN'?null:ctx.actor!.userId,state==='OPEN'?null:input.reason]);
  await tx.query('UPDATE integration_cursors SET row_version=row_version+1,updated_at=$3 WHERE source_system=$1 AND region_id=$2',[row.source_system,row.region_id,ctx.at]);
  await recordAudit(tx,ctx,{entityType:'integration_reconciliation',entityId:id,action:'INTEGRATION_RECONCILIATION_RECORDED',
    before:{state:row.state,rowVersion:row.row_version,mirror:result.before},
    after:{state,rowVersion:row.row_version+1,attemptId,action:input.action,outcome:result.outcome,reasonCode:result.reasonCode,mirror:result.after},
    reason:input.reason,institutionId:row.institution_id,visibility:'INTERNAL'});
  await emitEvent(tx,ctx,'INTEGRATION_RECONCILIATION_RECORDED','integration_reconciliation',id,{regionId:row.region_id,attemptId,outcome:result.outcome});
  return {mock:true,connected:false,notice:MOCK_NOTICE,provenance:'DEMO_ASSUMPTION',item:{id,state,rowVersion:row.row_version+1},
    attempt:{id:attemptId,outcome:result.outcome,reasonCode:result.reasonCode},syncState:{regionId:row.region_id,rowVersion:cursor.row_version+1}};
}
