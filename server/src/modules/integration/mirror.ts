import type { z } from 'zod';
import type { Db } from '../../db.js';
import { NotFoundError, one, q } from '../../db.js';
import type { sourceRecordSchema } from './contract.js';

/** Identical mirror rules for ordinary imports and explicit human reconciliation. Caller holds IMPORT_LOCK. */
export async function applySourceMirror(tx:Db,input:{
  sourceSystem:string;regionId:string;institutionId:string;mappingVersion:string;canonicalId:string;
  record:z.infer<typeof sourceRecordSchema>;statusCodes:Record<string,string>;at:Date;resolutionId?:string;
}) {
  const r=input.record;
  const old=(await q(tx,'SELECT * FROM integration_mirrors WHERE source_system=$1 AND external_id=$2 FOR UPDATE',[input.sourceSystem,r.externalId]))[0]??null;
  if(old&&old.region_id!==input.regionId)throw new NotFoundError('Source mirror not found');
  const status=Object.hasOwn(input.statusCodes,r.fields.statusCode)?input.statusCodes[r.fields.statusCode]:null;
  const reasonCode=!status?'UNKNOWN_CODE':old&&old.institution_id!==input.institutionId?'INSTITUTION_BINDING_CONFLICT':
    old&&r.revision<=old.latest_revision?'OUT_OF_ORDER':old&&Date.parse(r.sourceUpdatedAt)<old.source_updated_at.getTime()?'SOURCE_TIME_REGRESSION':null;
  if(reasonCode)return {applied:false as const,reasonCode,before:old,after:old};
  const mirror=await one(tx,`INSERT INTO integration_mirrors(source_system,external_id,region_id,institution_id,source_title,source_status,source_updated_at,latest_revision,latest_event_id,mapping_version_id,updated_at,latest_resolution_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(source_system,external_id) DO UPDATE SET
    source_title=EXCLUDED.source_title,source_status=EXCLUDED.source_status,source_updated_at=EXCLUDED.source_updated_at,
    latest_revision=EXCLUDED.latest_revision,latest_event_id=EXCLUDED.latest_event_id,mapping_version_id=EXCLUDED.mapping_version_id,
    row_version=integration_mirrors.row_version+1,updated_at=EXCLUDED.updated_at,latest_resolution_id=EXCLUDED.latest_resolution_id RETURNING *`,
    [input.sourceSystem,r.externalId,input.regionId,input.institutionId,r.fields.title,status,r.sourceUpdatedAt,r.revision,input.canonicalId,input.mappingVersion,input.at,input.resolutionId??null]);
  return {applied:true as const,reasonCode:null,before:old,after:mirror};
}
