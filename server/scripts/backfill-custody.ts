import {closePool,withTx} from '../src/db.js';
import {now} from '../src/lib/clock.js';
import {backfillCustody} from '../src/modules/custody/service.js';
try{console.log('Cases backfilled:',await withTx(tx=>backfillCustody(tx,{actor:null,at:now(),correlationId:'custody-backfill'})));}finally{await closePool();}
