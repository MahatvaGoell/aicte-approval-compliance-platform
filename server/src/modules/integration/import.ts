import type { Db } from '../../db.js';
import { ConflictError, NotFoundError, one, q } from '../../db.js';
import { canonicalJson, sha256 } from '../../lib/crypto.js';
import { recordAudit, type ActionContext } from '../audit/audit.js';
import { emitEvent } from '../outbox/outbox.js';
import { assertIntegrationAccess, requireIntegrationRegion, sourceInstitution } from './access.js';
import { identitySchema, MAPPING_VERSION, mappingSchema, MOCK_NOTICE, sourceRecordSchema, type Outcome, type SyncInput } from './contract.js';
import { applySourceMirror } from './mirror.js';

// Serialise mock source identity allocation across regions, then use cursor versions for stale requests.
// Keep this lock before recordAudit's lock in every future reconciliation mutation too.
export const IMPORT_LOCK=7340;
interface ItemResult {outcome:Outcome;reasonCode?:string;canonicalId?:string;details?:unknown}
const plain=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};

async function processRecord(tx:Db,ctx:ActionContext,input:SyncInput,runId:string,raw:unknown,ordinal:number,institutionId:string|null,statusCodes:Record<string,string>) {
  const hash=sha256(canonicalJson(raw));
  // Retain every observation, but don't recreate work for an identical canonical payload, even invalid ones.
  const previous=(await q(tx,`SELECT item.canonical_event_id FROM integration_raw_events raw
    JOIN integration_runs r ON r.id=raw.run_id JOIN integration_run_items item ON item.raw_event_id=raw.id
    WHERE r.source_system=$1 AND r.region_id=$2 AND raw.payload_sha256=$3 LIMIT 1`,[input.sourceSystem,input.regionId,hash]))[0];
  const receipt=await one(tx,`INSERT INTO integration_raw_events(run_id,ordinal,payload,payload_sha256,institution_id,received_at)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[runId,ordinal,JSON.stringify(raw),hash,institutionId,ctx.at]);
  let result:ItemResult,canonicalId:string|undefined,before:unknown=null,after:unknown=null,mirrorId:string|undefined;
  if(previous) result={outcome:'DUPLICATE',canonicalId:previous.canonical_event_id??undefined};
  else {
    const identity=identitySchema.safeParse(raw);
    if(!identity.success) result={outcome:'INVALID',reasonCode:'INVALID_IDENTITY',details:identity.error.issues.map(x=>({field:x.path.join('.'),message:x.message}))};
    else {
      const x=identity.data;
      const collision=await q(tx,`SELECT id FROM integration_source_events WHERE source_system=$1 AND external_id=$2 AND (event_id=$3 OR revision=$4)`,[input.sourceSystem,x.externalId,x.eventId,x.revision]);
      if(collision.length) result={outcome:'RECONCILIATION',reasonCode:'IDENTITY_CONFLICT'};
      else {
        canonicalId=(await one(tx,`INSERT INTO integration_source_events(source_system,region_id,external_id,event_id,revision,raw_event_id)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[input.sourceSystem,input.regionId,x.externalId,x.eventId,x.revision,receipt.id])).id;
        const parsed=sourceRecordSchema.safeParse(raw);
        if(!parsed.success) result={outcome:'INVALID',reasonCode:'INVALID_RECORD',canonicalId,details:parsed.error.issues.map(x=>({field:x.path.join('.'),message:x.message}))};
        else if(!institutionId) result={outcome:'RECONCILIATION',reasonCode:'INSTITUTION_UNMAPPED',canonicalId};
        else {
          const mirror=await applySourceMirror(tx,{sourceSystem:input.sourceSystem,regionId:input.regionId,institutionId,mappingVersion:MAPPING_VERSION,
            canonicalId:canonicalId!,record:parsed.data,statusCodes,at:ctx.at});
          if(!mirror.applied)result={outcome:'RECONCILIATION',reasonCode:mirror.reasonCode,canonicalId};
          else {mirrorId=mirror.after.id;before=mirror.before;after=mirror.after;result={outcome:'ACCEPTED',canonicalId};}
        }
      }
    }
  }
  if(result.outcome==='INVALID'||result.outcome==='RECONCILIATION') await tx.query(`INSERT INTO integration_reconciliation(raw_event_id,reason_code,created_at) VALUES($1,$2,$3)`,[receipt.id,result.reasonCode,ctx.at]);
  await tx.query(`INSERT INTO integration_run_items(raw_event_id,canonical_event_id,outcome,reason_code,details) VALUES($1,$2,$3,$4,$5)`,[receipt.id,result.canonicalId??null,result.outcome,result.reasonCode??null,JSON.stringify(result.details??[])]);
  await recordAudit(tx,ctx,{entityType:mirrorId?'integration_mirror':'integration_raw_event',entityId:mirrorId??receipt.id,action:'INTEGRATION_RECORD_OBSERVED',
    before,after:{runId,rawEventId:receipt.id,outcome:result.outcome,reasonCode:result.reasonCode??null,mirror:after},reason:input.reason,institutionId,visibility:'INTERNAL'});
  return result.outcome;
}

/** State, raw receipts, mirror changes, queue items, audit and outbox share the caller's transaction. */
export async function syncImport(tx:Db,ctx:ActionContext,input:SyncInput,events:unknown[]) {
  const actor=ctx.actor!;assertIntegrationAccess(actor,true);await requireIntegrationRegion(tx,actor,input.regionId);
  await tx.query('SELECT pg_advisory_xact_lock($1)',[IMPORT_LOCK]);
  await tx.query(`INSERT INTO integration_cursors(source_system,region_id,updated_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[input.sourceSystem,input.regionId,ctx.at]);
  const cursor=await one(tx,'SELECT row_version FROM integration_cursors WHERE source_system=$1 AND region_id=$2 FOR UPDATE',[input.sourceSystem,input.regionId]);
  if(cursor.row_version!==input.expectedVersion) throw new ConflictError('The integration cursor changed. Refresh before syncing.',{code:'STALE_VERSION',currentVersion:cursor.row_version});
  const mapping=await one(tx,'SELECT * FROM integration_mapping_versions WHERE id=$1 AND source_system=$2',[MAPPING_VERSION,input.sourceSystem]);
  const {statusCodes}=mappingSchema.parse(mapping.document);
  // Preflight every target before persisting observations. No mixed-region batch or identity rebinding.
  const institutions:Array<string|null>=[];
  for(const raw of events) {
    const obj=plain(raw);
    if(typeof obj.externalId==='string'&&(await q(tx,'SELECT 1 FROM integration_source_events WHERE source_system=$1 AND external_id=$2 AND region_id<>$3 LIMIT 1',[input.sourceSystem,obj.externalId,input.regionId])).length) throw new NotFoundError('Source record not found');
    institutions.push(typeof obj.institutionCode==='string'&&/^DEMO-[A-Za-z0-9-]{1,60}$/.test(obj.institutionCode)?await sourceInstitution(tx,actor,obj.institutionCode,input.regionId):null);
  }
  const run=await one(tx,`INSERT INTO integration_runs(source_system,region_id,mapping_version_id,input_kind,started_by,started_at)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[input.sourceSystem,input.regionId,MAPPING_VERSION,input.events?'INLINE':'FIXTURE',actor.userId,ctx.at]);
  const counts={accepted:0,duplicate:0,invalid:0,reconciliation:0};
  const key={ACCEPTED:'accepted',DUPLICATE:'duplicate',INVALID:'invalid',RECONCILIATION:'reconciliation'} as const;
  for(let i=0;i<events.length;i++) counts[key[await processRecord(tx,ctx,input,run.id,events[i],i+1,institutions[i],statusCodes)]]++;
  await tx.query(`UPDATE integration_runs SET state='COMPLETED',completed_at=$2,total_count=$3,accepted_count=$4,duplicate_count=$5,invalid_count=$6,reconciliation_count=$7 WHERE id=$1`,[run.id,ctx.at,events.length,counts.accepted,counts.duplicate,counts.invalid,counts.reconciliation]);
  await tx.query('UPDATE integration_cursors SET row_version=row_version+1,updated_at=$3 WHERE source_system=$1 AND region_id=$2',[input.sourceSystem,input.regionId,ctx.at]);
  await recordAudit(tx,ctx,{entityType:'integration_run',entityId:run.id,action:'INTEGRATION_SYNC_COMPLETED',before:{cursorVersion:cursor.row_version},after:{regionId:input.regionId,mappingVersion:MAPPING_VERSION,total:events.length,counts,cursorVersion:cursor.row_version+1},reason:input.reason});
  await emitEvent(tx,ctx,'INTEGRATION_SYNC_COMPLETED','integration_run',run.id,{regionId:input.regionId,total:events.length,counts});
  return {mock:true,connected:false,notice:MOCK_NOTICE,run:{id:run.id,sourceSystem:input.sourceSystem,regionId:input.regionId,mappingVersion:MAPPING_VERSION,state:'COMPLETED',total:events.length,counts,startedAt:ctx.at,completedAt:ctx.at},syncState:{regionId:input.regionId,rowVersion:cursor.row_version+1}};
}
