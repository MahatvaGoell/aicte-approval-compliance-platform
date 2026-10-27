// This protocol contains no database access. The witness signs only hashes, counts and times.
import crypto from 'node:crypto';
import {z} from 'zod';
import {canonicalJson,sha256} from '../lib/crypto.js';
export const checkpointSchema=z.object({lastId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),lastHash:z.string().regex(/^[a-f0-9]{64}$/),count:z.number().int().positive(),at:z.string().datetime()}).strict().refine(c=>c.count<=c.lastId,'Count cannot exceed the last sequence ID');
export type Checkpoint=z.infer<typeof checkpointSchema>;
export const receiptSchema=z.object({checkpoint:checkpointSchema,keyId:z.string().regex(/^[a-f0-9]{16}$/),witnessedAt:z.string().datetime(),signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)}).strict();
export type WitnessReceipt=z.infer<typeof receiptSchema>;
export function signReceipt(checkpoint:Checkpoint,privateKey:string,publicKey:string,witnessedAt:Date):WitnessReceipt {
 const signed={checkpoint,keyId:sha256(publicKey).slice(0,16),witnessedAt:witnessedAt.toISOString()};
 return {...signed,signature:crypto.sign(null,Buffer.from(canonicalJson(signed)),privateKey).toString('base64url')};
}
export function verifyReceipt(raw:unknown,publicKey:string):raw is WitnessReceipt {
 try{
  const parsed=receiptSchema.safeParse(raw);if(!parsed.success)return false;const {signature,...signed}=parsed.data;
  return signed.keyId===sha256(publicKey).slice(0,16)&&crypto.createPublicKey(publicKey).asymmetricKeyType==='ed25519'&&crypto.verify(null,Buffer.from(canonicalJson(signed)),publicKey,Buffer.from(signature,'base64url'));
 }catch{return false;}
}
