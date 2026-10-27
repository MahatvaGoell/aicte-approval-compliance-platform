import fs from 'node:fs/promises';
import {z} from 'zod';
import {config} from '../../config.js';
import type {Db} from '../../db.js';
import {getPool,maybe,q,withTx} from '../../db.js';
import {now} from '../../lib/clock.js';
import {canonicalJson} from '../../lib/crypto.js';
import {emitEvent} from '../outbox/outbox.js';
import {recordAudit} from './audit.js';
import {checkpointSchema,receiptSchema,verifyReceipt,type Checkpoint,type WitnessReceipt} from '../../witness/protocol.js';
/** DEMO_ASSUMPTION: publish after 25 events or 5 minutes; only loopback HTTP is permitted. */
export const WITNESS_POLICY={events:25,minutes:5,provenance:'DEMO_ASSUMPTION'} as const;
function witnessUrl() {
 const url=new URL(config.witnessUrl);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw new Error('Witness URL must be local loopback HTTP');
 return url.href.replace(/\/$/,'');
}
async function publicKey(){return fs.readFile(config.witnessPublicKeyPath,'utf8');}
async function requestWitness(route:string,body?:unknown) {
 const response=await fetch(witnessUrl()+route,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2000),redirect:'error'});
 if(!response.ok)throw new Error('Witness unavailable');return response.json();
}
/** Durable outbox request first, local witness side effect after commit, signed receipt and audit together. */
export async function publishCheckpoint(force=false) {
 const at=now(),ctx={actor:null,at,correlationId:'audit-witness-worker'};
 try{
  const key=await publicKey();
  const event=await withTx(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(7301)');
   const pending=await maybe(tx,`SELECT id,payload FROM outbox_events WHERE event_type='AUDIT_CHECKPOINT_REQUESTED' AND state='PENDING' ORDER BY id LIMIT 1`);if(pending)return pending;
   const head=await maybe(tx,'SELECT id,hash FROM audit_events ORDER BY id DESC LIMIT 1');if(!head)return null;
   const count=(await q(tx,'SELECT count(*)::int AS n FROM audit_events'))[0].n;
   const last=await maybe(tx,'SELECT * FROM audit_checkpoints ORDER BY last_id DESC LIMIT 1');
   if(last&&last.last_id===head.id&&last.last_hash===head.hash)return null;
   if(!force&&last&&count-last.event_count<WITNESS_POLICY.events&&at.getTime()-new Date(last.at).getTime()<WITNESS_POLICY.minutes*60000)return null;
   const checkpoint:Checkpoint={lastId:head.id,lastHash:head.hash,count,at:at.toISOString()};
   await recordAudit(tx,ctx,{entityType:'audit_checkpoint',entityId:String(head.id),action:'AUDIT_CHECKPOINT_REQUESTED',after:{...checkpoint,provenance:WITNESS_POLICY.provenance}});
   await emitEvent(tx,ctx,'AUDIT_CHECKPOINT_REQUESTED','audit_checkpoint',String(head.id),{checkpoint});
   return (await q(tx,`SELECT id,payload FROM outbox_events WHERE event_type='AUDIT_CHECKPOINT_REQUESTED' AND aggregate_id=$1 ORDER BY id DESC LIMIT 1`,[String(head.id)]))[0];
  });
  if(!event)return {status:'NOT_DUE' as const};
  const checkpoint=checkpointSchema.parse(event.payload.checkpoint);
  const receipt=await requestWitness('/checkpoints',checkpoint);
  if(!verifyReceipt(receipt,key)||receipt.checkpoint.lastId!==checkpoint.lastId||receipt.checkpoint.lastHash!==checkpoint.lastHash||receipt.checkpoint.count!==checkpoint.count)throw new Error('Witness receipt signature or checkpoint mismatch');
  await withTx(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(7301)');
   const pending=await maybe(tx,`SELECT id FROM outbox_events WHERE id=$1 AND state='PENDING' FOR UPDATE`,[event.id]);if(!pending)return;
   const saved=(await q(tx,`INSERT INTO audit_checkpoints(last_id,last_hash,event_count,at,witness_key_id,receipt,received_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(last_id,last_hash) DO NOTHING RETURNING id`,[receipt.checkpoint.lastId,receipt.checkpoint.lastHash,receipt.checkpoint.count,receipt.checkpoint.at,receipt.keyId,JSON.stringify(receipt),at]))[0];
   await tx.query(`UPDATE outbox_events SET state='PROCESSED',processed_at=$2,attempts=attempts+1 WHERE id=$1`,[event.id,at]);
   if(saved)await recordAudit(tx,ctx,{entityType:'audit_checkpoint',entityId:saved.id,action:'AUDIT_CHECKPOINT_WITNESSED',after:{lastId:receipt.checkpoint.lastId,keyId:receipt.keyId,requestEventId:event.id}});
  });
  return {status:'WITNESSED' as const,receipt};
 }catch{return {status:'UNAVAILABLE' as const,problem:'Witness unavailable'};}
}
export interface WitnessVerification {status:'PASS'|'FAIL'|'UNAVAILABLE'|'NOT_WITNESSED';ok:boolean|null;problem:string|null;checked?:number;firstBrokenCheckpointId?:number|null}
export async function verifyWitness(db:Db):Promise<WitnessVerification> {
 let receipts:WitnessReceipt[],key:string;
 try{key=await publicKey();const raw=await requestWitness('/checkpoints');receipts=z.object({receipts:z.array(receiptSchema).max(100000)}).parse(raw).receipts;}
 catch{return {status:'UNAVAILABLE',ok:null,problem:'Witness unavailable'};}
 const fail=(id:number|null,problem:string):WitnessVerification=>({status:'FAIL',ok:false,problem,firstBrokenCheckpointId:id});
 if(receipts.some(r=>!verifyReceipt(r,key)))return fail(null,'Witness receipt signature is invalid');
 const saved=await q(db,'SELECT last_id,last_hash,event_count,receipt FROM audit_checkpoints ORDER BY last_id');
 const remote=new Set(receipts.map(r=>canonicalJson(r)));
 for(const row of saved)if(!verifyReceipt(row.receipt,key)||row.receipt.checkpoint.lastId!==row.last_id||row.receipt.checkpoint.lastHash!==row.last_hash||row.receipt.checkpoint.count!==row.event_count||!remote.has(canonicalJson(row.receipt)))return fail(row.last_id,'Stored receipt does not match the signed witness record');
 if(!receipts.length)return {status:'NOT_WITNESSED',ok:null,problem:'No witnessed checkpoint recorded',checked:0};
 for(const receipt of receipts){
  const checkpoint=receipt.checkpoint;
  const row=await maybe(db,'SELECT hash FROM audit_events WHERE id=$1',[checkpoint.lastId]);
  const count=(await q(db,'SELECT count(*)::int AS n FROM audit_events WHERE id<=$1',[checkpoint.lastId]))[0].n;
  if(!row||row.hash!==checkpoint.lastHash||count!==checkpoint.count)return fail(checkpoint.lastId,'Stored audit prefix differs from the witnessed checkpoint');
 }
 return {status:'PASS',ok:true,problem:null,checked:receipts.length,firstBrokenCheckpointId:null};
}
