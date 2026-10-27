// A separate local process. It never imports a database module or reads the main database.
import Fastify from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonicalJson} from '../lib/crypto.js';
import {now} from '../lib/clock.js';
import {checkpointSchema,receiptSchema,signReceipt,verifyReceipt,type WitnessReceipt} from './protocol.js';
async function witnessKeys(dir:string) {
 const keyDir=path.join(dir,'keys');await fs.mkdir(keyDir,{recursive:true});
 const privatePath=path.join(keyDir,'private.pem'),publicPath=path.join(keyDir,'public.pem');
 try{return {privateKey:await fs.readFile(privatePath,'utf8'),publicKey:await fs.readFile(publicPath,'utf8')};}
 catch(e){
  if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  const files=await fs.readdir(keyDir);if(files.length)throw new Error('Incomplete witness key pair; restore it rather than replacing checkpoint identity');
  const keys=crypto.generateKeyPairSync('ed25519',{privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}});
  await fs.writeFile(privatePath,keys.privateKey,{flag:'wx',mode:0o600});await fs.writeFile(publicPath,keys.publicKey,{flag:'wx',mode:0o644});return keys;
 }
}
export async function createWitness(directory:string) {
 await fs.mkdir(directory,{recursive:true});const keys=await witnessKeys(directory),file=path.join(directory,'checkpoints.jsonl');
 const text=await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
 const receipts:WitnessReceipt[]=text.split('\n').filter(Boolean).map(line=>receiptSchema.parse(JSON.parse(line)));
 if(receipts.some(r=>!verifyReceipt(r,keys.publicKey)))throw new Error('Witness store contains an invalid receipt');
 let previous=0;for(const receipt of receipts){if(receipt.checkpoint.lastId<=previous)throw new Error('Witness checkpoint order is invalid');previous=receipt.checkpoint.lastId;}
 const app=Fastify({logger:false,bodyLimit:16384});let serial:Promise<unknown>=Promise.resolve();
 app.get('/health',async()=>({status:'ready',store:'append-only local JSONL'}));
 app.get('/checkpoints',async()=>{await serial;return {receipts};});
 app.post('/checkpoints',async(req,reply)=>{
  const parsed=checkpointSchema.safeParse(req.body);if(!parsed.success)return reply.code(422).send({error:'Invalid checkpoint'});
  const job=serial.then(async()=>{
   const checkpoint=parsed.data,existing=receipts.find(r=>r.checkpoint.lastId===checkpoint.lastId);
   if(existing){
    if(existing.checkpoint.lastHash!==checkpoint.lastHash||existing.checkpoint.count!==checkpoint.count)throw new Error('CHECKPOINT_CONFLICT');
    return existing;
   }
   const last=receipts.at(-1)?.checkpoint;
   if(last&&(checkpoint.lastId<=last.lastId||checkpoint.count<=last.count))throw new Error('CHECKPOINT_ORDER');
   const receipt=signReceipt(checkpoint,keys.privateKey,keys.publicKey,now());
   const handle=await fs.open(file,'a',0o600);try{await handle.writeFile(canonicalJson(receipt)+'\n');await handle.sync();}finally{await handle.close();}
   receipts.push(receipt);return receipt;
  });
  serial=job.catch(()=>undefined);
  try{return await job;}catch(e){const message=(e as Error).message;return reply.code(message.startsWith('CHECKPOINT_')?409:503).send({error:message.startsWith('CHECKPOINT_')?message:'Witness storage unavailable'});}
 });
 return app;
}
