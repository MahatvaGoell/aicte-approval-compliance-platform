import {z} from 'zod';
import {AppError,q} from '../../db.js';
import {recordAudit} from '../audit/audit.js';
import {coversRegion,has} from '../identity/permissions.js';
import {emitEvent} from '../outbox/outbox.js';
import type {CommandDef} from '../applications/command-kit.js';
import {deny} from '../applications/command-kit.js';
export const CLAIM_COMMANDS:CommandDef<any>[]=[{
 name:'REVIEW_DOUBLE_CLAIM',label:'Record an officer review of a double claim',
 input:z.object({flagId:z.string().uuid(),expectedFlagVersion:z.number().int().positive(),outcome:z.enum(['EXPLAINED','CONFIRMED']),note:z.string().trim().min(20).max(4000),visibleToInstitution:z.boolean().default(false)}),
 guard(c){if(!has(c.actor,'CASE_REVIEW')||!coversRegion(c.actor,c.app.region_id))return deny(403,'MISSING_CAPABILITY','A case officer with the review capability must review this flag');if(!c.claimFlagIds?.length)return deny(409,'NO_DOUBLE_CLAIMS','No resource flag is recorded on this case');return null;},
 async run(tx,c,ctx,input){
  await tx.query('SELECT pg_advisory_xact_lock(7301)');
  const flag=(await q(tx,`SELECT f.* FROM claim_flags f WHERE f.id=$1 AND EXISTS(SELECT 1 FROM resource_claims x WHERE x.application_id=$2 AND x.id=ANY(f.claim_ids)) FOR UPDATE`,[input.flagId,c.app.id]))[0];
  if(!flag)throw new AppError(404,'NOT_FOUND','Flag not found');
  if(flag.row_version!==input.expectedFlagVersion)throw new AppError(409,'STALE_FLAG_VERSION','This shared flag was reviewed elsewhere. Refresh before reviewing it.');
  await tx.query(`UPDATE claim_flags SET row_version=row_version+1,state=$2,review_note=$3,reviewed_by=$4,reviewed_at=$5,review_application_id=$6,note_visible_to_institution=$7 WHERE id=$1`,[flag.id,input.outcome,input.note,c.actor.userId,ctx.at,c.app.id,input.visibleToInstitution]);
  const cases=await q(tx,`SELECT DISTINCT application_id,institution_id FROM resource_claims WHERE id=ANY($1::uuid[])`,[flag.claim_ids]);
  for(const target of cases)await recordAudit(tx,ctx,{entityType:'claim_flag',entityId:flag.id,action:'DOUBLE_CLAIM_REVIEWED',before:{state:flag.state},after:{state:input.outcome,...(target.application_id===c.app.id?{note:input.note,visibleToInstitution:input.visibleToInstitution}:{})},applicationId:target.application_id,institutionId:target.institution_id,visibility:target.application_id===c.app.id&&input.visibleToInstitution?'INSTITUTION':'INTERNAL'});
  await emitEvent(tx,ctx,'DOUBLE_CLAIM_REVIEWED','claim_flag',flag.id,{applicationId:c.app.id,visibleToInstitution:input.visibleToInstitution});
  return {flagId:flag.id,state:input.outcome};
 }
}];
