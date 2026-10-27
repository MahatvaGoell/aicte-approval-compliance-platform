import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {config,repoRoot} from '../../config.js';
import {AppError} from '../../db.js';
import {sha256} from '../../lib/crypto.js';
export interface DemoKey {keyId:string;privateKey:string;publicKey:string}
export const approvalKeyDir=()=>path.join(repoRoot,'var','keys');
export function newDemoKey():DemoKey {
 const pair=crypto.generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 return {keyId:sha256(pair.publicKey).slice(0,16),...pair};
}
let testKey:DemoKey|undefined;
export async function generateApprovalDemoKey() {
 if(!config.demoMode)throw new Error('Demo key generation requires DEMO_MODE=true');
 const dir=approvalKeyDir();await fs.mkdir(dir,{recursive:true});
 try{const active=JSON.parse(await fs.readFile(path.join(dir,'approval-active.json'),'utf8'));return String(active.keyId);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const key=newDemoKey();
 await fs.writeFile(path.join(dir,`${key.keyId}.private.pem`),key.privateKey,{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(dir,`${key.keyId}.public.pem`),key.publicKey,{flag:'wx',mode:0o644});
 await fs.writeFile(path.join(dir,'approval-active.json'),JSON.stringify({keyId:key.keyId,demo:true}),{flag:'wx',mode:0o600});return key.keyId;
}
export async function approvalSigningKey():Promise<DemoKey> {
 if(process.env.NODE_ENV==='test')return testKey??=newDemoKey();
 if(!config.demoMode)throw new AppError(503,'LETTER_KEY_NOT_CONFIGURED','This prototype issues letters only with an explicitly configured demo key');
 try{
  const active=JSON.parse(await fs.readFile(path.join(approvalKeyDir(),'approval-active.json'),'utf8'));
  if(!/^[a-f0-9]{16}$/.test(active.keyId))throw new Error('Invalid key ID');
  const [privateKey,publicKey]=await Promise.all([fs.readFile(path.join(approvalKeyDir(),`${active.keyId}.private.pem`),'utf8'),fs.readFile(path.join(approvalKeyDir(),`${active.keyId}.public.pem`),'utf8')]);
  if(sha256(publicKey).slice(0,16)!==active.keyId)throw new Error('Key identity mismatch');return {keyId:active.keyId,privateKey,publicKey};
 }catch{throw new AppError(503,'DEMO_KEY_MISSING','Run npm run keys:demo before recording an approval in this local demo');}
}
export async function approvalPublicKey(keyId:string) {
 if(!/^[a-f0-9]{16}$/.test(keyId))return null;
 if(process.env.NODE_ENV==='test'&&testKey?.keyId===keyId)return testKey.publicKey;
 try{const key=await fs.readFile(path.join(approvalKeyDir(),`${keyId}.public.pem`),'utf8');return sha256(key).slice(0,16)===keyId?key:null;}catch{return null;}
}
