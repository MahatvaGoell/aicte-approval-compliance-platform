import {z} from 'zod';
import {AppError,q} from '../../db.js';
import {recordAudit} from '../audit/audit.js';
import {coversRegion,has} from '../identity/permissions.js';
import {emitEvent} from '../outbox/outbox.js';
import type {CommandDef} from '../applications/command-kit.js';
import {deny} from '../applications/command-kit.js';
export const LETTER_COMMANDS:CommandDef<any>[]=[{
 name:'REVOKE_LETTER',label:'Revoke an issued demo approval letter',input:z.object({letterId:z.string().uuid(),reason:z.string().trim().min(1).max(2000)}),
 guard(c){if(!has(c.actor,'DECISION_RECORD')||!coversRegion(c.actor,c.app.region_id))return deny(403,'MISSING_CAPABILITY','An authority must revoke an issued letter');if(!c.approvalLetterIds?.length)return deny(409,'NO_LIVE_LETTER','No unrevoked approval letter is recorded');return null;},
 async run(tx,c,ctx,input){
  const letter=(await q(tx,'SELECT * FROM approval_letters WHERE id=$1 AND application_id=$2 FOR UPDATE',[input.letterId,c.app.id]))[0];
  if(!letter)throw new AppError(404,'NOT_FOUND','Letter not found');if(letter.revoked_at)throw new AppError(409,'LETTER_ALREADY_REVOKED','This letter is already revoked');
  await tx.query('UPDATE approval_letters SET revoked_at=$2,revoke_reason=$3 WHERE id=$1',[letter.id,ctx.at,input.reason]);
  await recordAudit(tx,ctx,{entityType:'approval_letter',entityId:letter.id,action:'APPROVAL_LETTER_REVOKED',before:{revokedAt:null},after:{revokedAt:ctx.at},reason:input.reason,applicationId:c.app.id,institutionId:c.app.institution_id,visibility:'INSTITUTION'});
  await emitEvent(tx,ctx,'APPROVAL_LETTER_REVOKED','approval_letter',letter.id,{applicationId:c.app.id});return {letterId:letter.id,revoked:true};
 }
}];
