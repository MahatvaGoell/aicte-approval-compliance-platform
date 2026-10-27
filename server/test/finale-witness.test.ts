import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {FastifyInstance} from 'fastify';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {config} from '../src/config.js';
import {closePool,getPool,q,withTx} from '../src/db.js';
import {now,advanceTestNow} from '../src/lib/clock.js';
import {recordAudit,verifyChain} from '../src/modules/audit/audit.js';
import {rewriteDemoChain} from '../src/modules/audit/rewrite-demo.js';
import {publishCheckpoint,verifyWitness} from '../src/modules/audit/witness.js';
import {createWitness} from '../src/witness/server.js';
import {verifyReceipt,type WitnessReceipt} from '../src/witness/protocol.js';
import {resetDatabase,signIn,startApp} from './helpers.js';
let witness:FastifyInstance,app:FastifyInstance,directory:string,receipt:WitnessReceipt,publicKey:string,firstCheckpoint:number;
const old={url:config.witnessUrl,key:config.witnessPublicKeyPath,demo:config.demoMode};
beforeAll(async()=>{
 await resetDatabase();config.demoMode=true;directory=await fs.mkdtemp(path.join(os.tmpdir(),'aicte-witness-'));witness=await createWitness(directory);await witness.listen({host:'127.0.0.1',port:0});
 const address=witness.server.address() as {port:number};config.witnessUrl=`http://127.0.0.1:${address.port}`;config.witnessPublicKeyPath=path.join(directory,'keys','public.pem');publicKey=await fs.readFile(config.witnessPublicKeyPath,'utf8');app=await startApp();
});
afterAll(async()=>{await witness?.close();await app?.close();Object.assign(config,{witnessUrl:old.url,witnessPublicKeyPath:old.key,demoMode:old.demo});await closePool();});
it('WA01 untouched chain passes local recomputation and both independently signed checkpoints',async()=>{
 const first=await publishCheckpoint(true);expect(first.status).toBe('WITNESSED');if(first.status!=='WITNESSED')throw new Error('No receipt');firstCheckpoint=first.receipt.checkpoint.lastId;
 advanceTestNow(60000);await withTx(tx=>recordAudit(tx,{actor:null,at:now(),correlationId:'witness-test'},{entityType:'test',entityId:'checkpoint-two',action:'WITNESS_TEST_EVENT',after:{synthetic:true}}));
 const second=await publishCheckpoint(true);expect(second.status).toBe('WITNESSED');if(second.status!=='WITNESSED')throw new Error('No second receipt');receipt=second.receipt;
 expect((await verifyChain(getPool())).ok).toBe(true);expect((await verifyWitness(getPool())).status).toBe('PASS');expect((await q(getPool(),'SELECT id FROM audit_checkpoints'))).toHaveLength(2);
 const auditor=await signIn(app,'auditor@demo.aicte.test'),result=(await auditor.post('/api/v1/audit/verify',{})).json();expect(result.local.ok).toBe(true);expect(result.witness.status).toBe('PASS');
 const duplicate=await fetch(config.witnessUrl+'/checkpoints',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(receipt.checkpoint)});expect(duplicate.ok).toBe(true);expect((await duplicate.json()).signature).toBe(receipt.signature);
});
it('WA02 superuser rewrite passes local verification but fails at the first witnessed prefix after the edit',async()=>{
 const target=(await q(getPool(),'SELECT id FROM audit_events ORDER BY id LIMIT 1'))[0].id;
 const result=await withTx(tx=>rewriteDemoChain(tx,target));expect(result.firstExpectedFailedCheckpoint).toBe(firstCheckpoint);
 expect((await verifyChain(getPool())).ok).toBe(true);const checked=await verifyWitness(getPool());expect(checked.status).toBe('FAIL');expect(checked.firstBrokenCheckpointId).toBe(firstCheckpoint);
 const enabled=(await q(getPool(),`SELECT tgenabled FROM pg_trigger WHERE tgname='audit_events_no_update'`))[0];expect(enabled.tgenabled).toBe('O');
 const was=config.demoMode;config.demoMode=false;await expect(withTx(tx=>rewriteDemoChain(tx,target))).rejects.toThrow('Refusing');config.demoMode=was;
});
it('WA03 witness down reports unavailable, never intact or pass',async()=>{
 await witness.close();const result=await verifyWitness(getPool());expect(result.status).toBe('UNAVAILABLE');expect(result.ok).toBeNull();expect(result.problem).toBe('Witness unavailable');
 const auditor=await signIn(app,'auditor@demo.aicte.test'),response=(await auditor.post('/api/v1/audit/verify',{})).json();expect(response.local.ok).toBe(true);expect(response.witness.status).toBe('UNAVAILABLE');
});
it('WA04 receipts are verified with the pinned witness public key and tampering is refused',()=>{
 expect(verifyReceipt(receipt,publicKey)).toBe(true);const tampered=structuredClone(receipt);tampered.checkpoint.lastHash='f'.repeat(64);expect(verifyReceipt(tampered,publicKey)).toBe(false);
 const signature=structuredClone(receipt);signature.signature=(signature.signature[0]==='A'?'B':'A')+signature.signature.slice(1);expect(verifyReceipt(signature,publicKey)).toBe(false);
});
