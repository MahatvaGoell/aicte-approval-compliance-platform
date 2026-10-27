import type {Db} from '../../db.js';
import {q,withTx} from '../../db.js';
import type {ActionContext} from '../audit/audit.js';
import {recordAudit} from '../audit/audit.js';
import type {Actor} from '../identity/permissions.js';
import {applicationScopeSql} from '../identity/permissions.js';
import {emitEvent} from '../outbox/outbox.js';
import {getPolicyVersion,type PolicyVersion} from '../policy/service.js';
import type {AppRow} from '../workflow/workflow.js';
import {findDoubleClaims,physicalIdentity,type Claim,type ResourceKind} from './engine.js';

export async function registerClaims(db:Db,ctx:ActionContext,app:AppRow,policy:PolicyVersion) {
 const form=app.draft_data;
 // Audit appends and detector writes always take these locks in the same order.
 await db.query('SELECT pg_advisory_xact_lock(7301)');await db.query('SELECT pg_advisory_xact_lock(7303)');
 for(const [field,kind] of [['faculty','FACULTY'],['labs','LAB'],['buildings','BUILDING']] as const)for(const entry of form[field]??[]){
  const identity=kind==='FACULTY'?entry.registrationId:physicalIdentity(entry.identifier,entry.address);
  const name=kind==='FACULTY'?entry.name:entry.identifier;
  const resource=(await q(db,`INSERT INTO resources(kind,identity_key,display_name,is_synthetic) VALUES($1,$2,$3,true) ON CONFLICT(kind,identity_key) DO UPDATE SET identity_key=EXCLUDED.identity_key RETURNING id`,[kind,identity,name]))[0];
  const claim=(await q(db,`INSERT INTO resource_claims(resource_id,application_id,institution_id,programme_code,usage,declared_name,period_from,period_to,source,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'APPLICATION_FORM',$9) RETURNING id`,[resource.id,app.id,app.institution_id,entry.programmeCode?.toUpperCase()??null,entry.usage??'Declared in application',name,entry.periodFrom,entry.periodTo??null,ctx.at]))[0];
  await recordAudit(db,ctx,{entityType:'resource_claim',entityId:claim.id,action:'RESOURCE_CLAIM_RECORDED',after:{kind,identityKey:identity,periodFrom:entry.periodFrom,periodTo:entry.periodTo??null,source:'APPLICATION_FORM'},applicationId:app.id,institutionId:app.institution_id,visibility:'INSTITUTION'});
 }
 return detectClaims(db,ctx,app.id,policy);
}
export async function detectClaims(db:Db,ctx:ActionContext,appId:string,policy:PolicyVersion) {
 const rule=policy.doc.doubleClaim;if(!rule)return 0;
 await db.query('SELECT pg_advisory_xact_lock(7301)');await db.query('SELECT pg_advisory_xact_lock(7303)');
 const rows=await q(db,`SELECT c.*,r.kind,r.identity_key FROM resource_claims c JOIN resources r ON r.id=c.resource_id WHERE c.resource_id IN(SELECT resource_id FROM resource_claims WHERE application_id=$1) ORDER BY c.id`,[appId]);
 const claims:Claim[]=rows.map(c=>({id:c.id,kind:c.kind,identityKey:c.identity_key,institutionId:c.institution_id,applicationId:c.application_id,programmeCode:c.programme_code,periodFrom:c.period_from,periodTo:c.period_to}));
 let created=0;
 for(const pair of findDoubleClaims(claims,rule)){
  const involved=rows.filter(c=>pair.claimIds.includes(c.id));if(!involved.some(c=>c.application_id===appId))continue;
  const flag=(await q(db,`INSERT INTO claim_flags(resource_id,claim_ids,detected_at,rule_ref,provenance) VALUES($1,$2,$3,$4,'DEMO_ASSUMPTION') ON CONFLICT(resource_id,claim_ids) DO NOTHING RETURNING id`,[involved[0].resource_id,pair.claimIds,ctx.at,`policy v${policy.versionNo}/doubleClaim`]))[0];
  if(!flag)continue;created++;
  for(const applicationId of new Set(involved.map(c=>c.application_id))){
   const own=involved.find(c=>c.application_id===applicationId)!;
   await recordAudit(db,ctx,{entityType:'claim_flag',entityId:flag.id,action:'DOUBLE_CLAIM_FLAGGED',after:{kind:pair.kind,state:'OPEN',provenance:'DEMO_ASSUMPTION'},applicationId,institutionId:own.institution_id,policyVersionId:policy.id,ruleRef:`policy v${policy.versionNo}/doubleClaim`,visibility:'INSTITUTION'});
   await emitEvent(db,ctx,'DOUBLE_CLAIM_DETECTED','claim_flag',flag.id,{applicationId,flagId:flag.id});
  }
 }
 return created;
}
/** Worker re-checks use each case's own pinned policy; historical cases are never migrated. */
export async function recheckClaims(at:Date) {
 return withTx(async tx=>{
  const apps=await q(tx,`SELECT DISTINCT w.application_id,w.policy_version_id FROM workflow_instances w JOIN resource_claims c ON c.application_id=w.application_id WHERE w.kind='PRIMARY' ORDER BY w.application_id`);
  let created=0;for(const a of apps)created+=await detectClaims(tx,{actor:null,at,correlationId:'double-claim-recheck'},a.application_id,await getPolicyVersion(tx,a.policy_version_id));return created;
 });
}
/** Called only after loadVisibleApplication or by the scoped report query. Never return raw claim_ids. */
export async function claimsForCase(db:Db,actor:Actor,appId:string) {
 const rows=await q(db,`SELECT f.*,c.id AS own_claim_id,c.period_from,c.period_to,c.declared_name,c.programme_code,r.kind AS resource_kind,r.identity_key FROM resource_claims c JOIN resources r ON r.id=c.resource_id JOIN claim_flags f ON c.id=ANY(f.claim_ids) WHERE c.application_id=$1 ORDER BY f.detected_at,f.id,c.id`,[appId]);
 const flags=[];
 for(const f of rows){
  const own=await q(db,'SELECT id FROM resource_claims WHERE application_id=$1 AND id=ANY($2::uuid[])',[appId,f.claim_ids]);
  const params:unknown[]=[f.claim_ids,appId];const scope=applicationScopeSql(actor,params);
  const visible=actor.role==='INSTITUTION_REP'?[]:await q(db,`SELECT DISTINCT a.id,a.app_no FROM resource_claims c JOIN applications a ON a.id=c.application_id WHERE c.id=ANY($1::uuid[]) AND a.id<>$2 AND ${scope}` ,params);
  const ownNote=f.review_application_id===appId&&f.note_visible_to_institution;
  const officerNote=f.review_application_id===appId||visible.some(c=>c.id===f.review_application_id);
  flags.push({id:f.id,rowVersion:f.row_version,ownClaimId:f.own_claim_id,resource:f.declared_name,kind:f.resource_kind,identityKey:f.identity_key,programmeCode:f.programme_code,periodFrom:f.period_from,periodTo:f.period_to,state:f.state,detectedAt:f.detected_at,ruleRef:f.rule_ref,provenance:f.provenance,
   otherClaims:visible.map(c=>({applicationId:c.id,appNo:c.app_no})),outsideScope:actor.role!=='INSTITUTION_REP'&&own.length+visible.length<f.claim_ids.length,
   sameCase:own.length>1,note:actor.role==='INSTITUTION_REP'?(ownNote?f.review_note:null):(officerNote?f.review_note:null),reviewedAt:f.reviewed_at});
 }
 return flags;
}
