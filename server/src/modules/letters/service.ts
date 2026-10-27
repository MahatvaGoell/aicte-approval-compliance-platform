import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {z} from 'zod';
import type {Db} from '../../db.js';
import {maybe,one,q} from '../../db.js';
import {config} from '../../config.js';
import {canonicalJson} from '../../lib/crypto.js';
import {now} from '../../lib/clock.js';
import type {ActionContext} from '../audit/audit.js';
import {recordAudit} from '../audit/audit.js';
import {openConditionsForDecision} from '../compliance/status.js';
import type {AppRow} from '../workflow/workflow.js';
import type {PolicyVersion} from '../policy/service.js';
import {approvalPublicKey,approvalSigningKey} from './keys.js';
const payloadSchema=z.object({letter_no:z.string().max(120),app_no:z.string().max(80),institution_name:z.string().max(500),category:z.string().max(80),outcome:z.enum(['APPROVED','APPROVED_WITH_CONDITIONS']),decision_date:z.string().datetime(),intake:z.number().int().nonnegative().nullable(),conditions:z.number().int().nonnegative(),policy_version:z.number().int().positive(),key_id:z.string().regex(/^[a-f0-9]{16}$/)}).strict();
export async function issueLetter(db:Db,ctx:ActionContext,app:AppRow,decisionId:string,policy:PolicyVersion) {
 const decision=await one(db,'SELECT * FROM decisions WHERE id=$1',[decisionId]);
 if(!['APPROVED','APPROVED_WITH_CONDITIONS'].includes(decision.outcome))return null;
 const frozen=await one(db,'SELECT submitted_snapshot FROM applications WHERE id=$1',[app.id]);
 const snapshot=frozen.submitted_snapshot;
 const key=await approvalSigningKey();
 const programmes=snapshot?.form?.programmes;
 const intake=Array.isArray(programmes)&&programmes.length&&programmes.every(p=>Number.isInteger(p.intake))?programmes.reduce((sum,p)=>sum+p.intake,0):null;
 const letterNo=`DEMO-${app.app_no}-${decisionId.slice(0,8)}`;
 const payload=payloadSchema.parse({letter_no:letterNo,app_no:app.app_no,institution_name:snapshot.institution.name,category:snapshot.proposal.categoryCode,outcome:decision.outcome,decision_date:new Date(decision.issued_at).toISOString(),intake,conditions:decision.conditions.length,policy_version:policy.versionNo,key_id:key.keyId});
 const signature=crypto.sign(null,Buffer.from(canonicalJson(payload)),key.privateKey).toString('base64url');
 const letter=(await q(db,`INSERT INTO approval_letters(decision_id,application_id,letter_no,payload,signature,key_id,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[decisionId,app.id,letterNo,JSON.stringify(payload),signature,key.keyId,ctx.at]))[0];
 await recordAudit(db,ctx,{entityType:'approval_letter',entityId:letter.id,action:'APPROVAL_LETTER_ISSUED',after:{letterNo,keyId:key.keyId,demoKey:true,provenance:'DEMO_ASSUMPTION'},applicationId:app.id,institutionId:app.institution_id,policyVersionId:policy.id,visibility:'INSTITUTION'});return letter.id;
}
export const letterToken=(letter:{payload:unknown;signature:string})=>Buffer.from(canonicalJson(letter.payload)).toString('base64url')+'.'+letter.signature;
const invalid=()=>({signatureValid:false,issuedBySystem:false,message:'This letter was not issued by this system',signedAtIssue:null,currentRecord:null,demoKey:true,checkedAt:now(),notice:'Verifies letters issued by this demo system only.'});
export async function verifyLetter(db:Db,token:string) {
 try{
  if(token.length>8192)return invalid();const parts=token.split('.');
  if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))return invalid();
  const bytes=Buffer.from(parts[0],'base64url'),sig=Buffer.from(parts[1],'base64url');
  if(bytes.toString('base64url')!==parts[0]||sig.toString('base64url')!==parts[1]||sig.length!==64)return invalid();
  const parsed=payloadSchema.safeParse(JSON.parse(bytes.toString('utf8')));if(!parsed.success)return invalid();
  const payload=parsed.data,canonical=canonicalJson(payload);if(bytes.toString('utf8')!==canonical)return invalid();
  const key=await approvalPublicKey(payload.key_id);if(!key||!crypto.verify(null,Buffer.from(canonical),key,sig))return invalid();
  const record=await maybe(db,'SELECT id,decision_id,application_id,payload,signature,revoked_at FROM approval_letters WHERE letter_no=$1 AND key_id=$2',[payload.letter_no,payload.key_id]);
  const issued=!!record&&record.signature===parts[1]&&canonicalJson(record.payload)===canonical;
  return {signatureValid:true,issuedBySystem:issued,message:issued?'Signature valid':'Signature valid; issue record not found',signedAtIssue:payload,currentRecord:issued?{recorded:true,revoked:!!record.revoked_at,revokedAt:record.revoked_at,openConditionsCount:await openConditionsForDecision(db,record.decision_id)}:{recorded:false},demoKey:true,checkedAt:now(),notice:'Verifies letters issued by this demo system only.'};
 }catch(e){if(e instanceof SyntaxError)return invalid();throw e;}
}
const qrCache=new Map<string,string>();
export async function lettersForCase(db:Db,appId:string) {
 const rows=await q(db,'SELECT * FROM approval_letters WHERE application_id=$1 ORDER BY issued_at,id',[appId]);const out=[];
 for(const l of rows){
  const token=letterToken(l),verifyUrl=`${config.appBaseUrl.replace(/\/$/,'')}/verify/${token}`;
  let qrDataUrl=qrCache.get(token);if(!qrDataUrl){qrDataUrl=await QRCode.toDataURL(verifyUrl,{errorCorrectionLevel:'M',margin:4,width:384});if(qrCache.size>=128)qrCache.delete(qrCache.keys().next().value!);qrCache.set(token,qrDataUrl);}
  out.push({id:l.id,letterNo:l.letter_no,payload:l.payload,token,verifyUrl,qrDataUrl,keyId:l.key_id,issuedAt:l.issued_at,revokedAt:l.revoked_at,revokeReason:l.revoke_reason,demoKey:true});
 }
 return out;
}
