import {config} from '../src/config.js';
import {closePool,q,withTx} from '../src/db.js';
import {rewriteDemoChain} from '../src/modules/audit/rewrite-demo.js';
if(!config.demoMode)throw new Error('Refusing chain rewrite outside DEMO_MODE=true');
try{
 const raw=process.argv.slice(2)[0];
 const result=await withTx(async tx=>{const id=raw?Number(raw):(await q(tx,'SELECT id FROM audit_events ORDER BY id LIMIT 1'))[0]?.id;if(!Number.isSafeInteger(id)||id<=0)throw new Error('Choose a positive audit event ID');return rewriteDemoChain(tx,id);});
 console.log(result);console.log('Expected: local chain passes; witness fails at the stored checkpoint. Reset the synthetic database AND witness store for a fresh demo.');
}finally{await closePool();}
