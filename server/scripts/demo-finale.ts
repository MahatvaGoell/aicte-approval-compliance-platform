import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {buildApp} from '../src/app.js';
import {config,repoRoot} from '../src/config.js';
import {closePool} from '../src/db.js';
if(!config.demoMode)throw new Error('Synthetic finale fixtures require DEMO_MODE=true');
const api=await buildApp();await api.ready();
async function client(email:string){
 const login=await api.inject({method:'POST',url:'/api/v1/auth/demo-login',headers:{'x-requested-with':'aicte-web'},payload:{email}});
 if(login.statusCode!==200)throw new Error(login.body);
 const cookie=String(login.headers['set-cookie']).split(';')[0];
 return async(url:string,payload:Record<string,unknown>)=>{const response=await api.inject({method:'POST',url:'/api/v1'+url,headers:{cookie,'x-requested-with':'aicte-web','idempotency-key':crypto.randomUUID()},payload});if(response.statusCode!==200)throw new Error(response.body);return response.json();};
}
const period={periodFrom:'2026-10-01',periodTo:'2027-09-30'},faculty={registrationId:'FAC-DEMO-0001',name:'Demo Faculty Alpha',programmeCode:'UG-CS',...period},building={identifier:'DEMO-PLOT-12',address:'12 Synthetic Campus Road',...period};
const fixtures=[
 {label:'Faculty overlap West',email:'inst.west@demo.aicte.test',faculty:[faculty]},
 {label:'Faculty overlap North',email:'inst.north@demo.aicte.test',faculty:[faculty]},
 {label:'Lab claimed by two programmes',email:'inst.west@demo.aicte.test',labs:[{identifier:'DEMO-LAB-1',address:'12 Synthetic Lab Road',programmeCode:'UG-CS',...period},{identifier:'demo lab 1',address:'12 Synthetic Lab Road',programmeCode:'UG-ME',...period}]},
 {label:'Building overlap West',email:'inst.west@demo.aicte.test',buildings:[building]},
 {label:'Building overlap North',email:'inst.north@demo.aicte.test',buildings:[building]},
 {label:'Honest same name, different ID',email:'inst.west@demo.aicte.test',faculty:[{...faculty,registrationId:'FAC-DEMO-0999'}]},
];
const cases=[];
try{
 for(const fixture of fixtures){
  const send=await client(fixture.email);const {label,email,...resources}=fixture;
  const created=await send('/applications',{cycleCode:'2027-28',categoryCode:'EXTENSION_OF_APPROVAL',draftData:{campusAddress:'12 Synthetic Campus Road',landAreaAcres:12,programmes:[{name:'Demo engineering programme',level:'UG',intake:60}],declarationAccepted:true,...resources}});
  await send(`/applications/${created.id}/submit`,{expectedVersion:created.rowVersion});cases.push({label,email,...created});
 }
 await fs.mkdir(path.join(repoRoot,'var'),{recursive:true});await fs.writeFile(path.join(repoRoot,'var/finale-cases.json'),JSON.stringify(cases,null,2));console.log(JSON.stringify(cases,null,2));
}finally{await api.close();await closePool();}
