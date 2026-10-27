import type {Db} from '../../db.js';
import {config} from '../../config.js';
import {q} from '../../db.js';
import {GENESIS_HASH,storedAuditHash} from './audit.js';
/** Deliberate superuser tampering for the local demo, outside normal command protections. */
export async function rewriteDemoChain(tx:Db,eventId:number) {
 if(!config.demoMode)throw new Error('Refusing chain rewrite outside DEMO_MODE');
 const user=(await q(tx,`SELECT usesuper FROM pg_user WHERE usename=current_user`))[0];if(!user?.usesuper)throw new Error('Demo rewrite requires a PostgreSQL superuser');
 await tx.query('SELECT pg_advisory_xact_lock(7301)');
 const rows=await q(tx,'SELECT * FROM audit_events ORDER BY id');const index=rows.findIndex(r=>r.id===eventId);if(index<0)throw new Error('Audit event not found');
 const checkpoints=await q(tx,'SELECT last_id FROM audit_checkpoints WHERE last_id>=$1 ORDER BY last_id',[eventId]);if(!checkpoints.length)throw new Error('Record a witnessed checkpoint after the chosen event before rewriting');
 await tx.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
 let previous=index?rows[index-1].hash:GENESIS_HASH;
 for(let i=index;i<rows.length;i++){
  const row=rows[i];if(i===index)row.reason=(row.reason??'')+' [synthetic demo rewrite]';
  const hash=storedAuditHash(previous,row);
  await tx.query('UPDATE audit_events SET reason=$2,prev_hash=$3,hash=$4 WHERE id=$1',[row.id,row.reason,previous,hash]);previous=hash;
 }
 await tx.query('ALTER TABLE audit_events ENABLE TRIGGER USER');return {editedEventId:eventId,firstExpectedFailedCheckpoint:checkpoints[0].last_id};
}
