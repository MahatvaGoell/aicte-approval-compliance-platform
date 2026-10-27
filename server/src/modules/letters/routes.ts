import type {FastifyInstance} from 'fastify';
import {AppError,getPool} from '../../db.js';
import {now} from '../../lib/clock.js';
import {verifyLetter} from './service.js';
/** DEMO_ASSUMPTION abuse bound: 60 public checks per source IP per minute, bounded map. */
export async function publicLetterRoutes(app:FastifyInstance) {
 const windows=new Map<string,{at:number;count:number}>();
 app.get<{Params:{token:string}}>('/public/verify/:token',async req=>{
  const at=now().getTime(),previous=windows.get(req.ip),slot=previous&&at>=previous.at&&at-previous.at<60000?previous:{at,count:0};
  if(++slot.count>60)throw new AppError(429,'RATE_LIMITED','Too many verification requests. Try again in a minute.');
  if(!windows.has(req.ip)&&windows.size>=10000)windows.delete(windows.keys().next().value!);windows.set(req.ip,slot);
  return verifyLetter(getPool(),req.params.token);
 });
}
