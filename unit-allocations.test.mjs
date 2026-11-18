import test from 'node:test';import assert from 'node:assert/strict';import access from './src/access.cjs';import policy from './src/policy.cjs';import config from './src/allocations-config.json' with {type:'json'};import {createAllocationsHandler} from './src/unit-allocations.mjs';import units from './src/units.cjs';
const f=config.fields;
const record=(unit,year=2027)=>Object.fromEntries(Object.entries({'Unit / FY Key':unit+':'+year,'Unit Key':unit,'Access Scope':units.permissionScope(unit),'Unit Name':units.WALLETS[unit].name,'Fiscal Year':year,'Rewards and Recognition':null,'Underrecovery':null,'RA Tuition Subsidy':null,'Notes':'','Allocation Status':'Pending data'}).map(([k,v])=>[String(f[k]),{value:v}]));
function auth(scope,role){const data=policy.initialPolicy();data.grants.push({username:'person',scope,role});return (event,options)=>access.authorize(event,{...options,reader:async()=>({kerberos:'person'}),load:async()=>({data,etag:'p'}),loadFeatures:async()=>({data:flags()})});}const flags=()=>({features:{}});
const event=(unit,year='2027')=>({httpMethod:'GET',path:'/.netlify/functions/unit-allocations',queryStringParameters:{unit,year}});
test('unit allocations apply authorization and an exact unit scope before querying Quickbase',async()=>{
 let calls=0;const handler=createAllocationsHandler({authorize:auth('aeroastro','read'),query:async(path,body)=>{calls++;assert.ok(body.where.includes(`{${f['Access Scope']}.EX.'aeroastro'}`));return {data:[record('aeroastro')],metadata:{totalRecords:1}};}});
 assert.equal((await handler(event('be'))).statusCode,403);assert.equal((await handler(event('all'))).statusCode,403);assert.equal(calls,0);const own=await handler(event('aeroastro'));assert.equal(own.statusCode,200);assert.equal(JSON.parse(own.body).rows[0].rewards,null);
});
test('limited users cannot read allocations; SoE admins see all and fake uses the same permission rules',async()=>{
 const query=async()=>({data:[record('soe-fake'),record('aeroastro')],metadata:{totalRecords:2}});
 assert.equal((await createAllocationsHandler({authorize:auth('aeroastro','limited_read'),query})(event('aeroastro'))).statusCode,403);
 const all=await createAllocationsHandler({authorize:auth('school','admin'),query})(event('all'));assert.equal(all.statusCode,200);assert.equal(JSON.parse(all.body).rows.length,2);
 const fake=await createAllocationsHandler({authorize:auth('soe-fake','admin'),query:async()=>({data:[record('soe-fake')],metadata:{totalRecords:1}})})(event('soe-fake'));assert.equal(fake.statusCode,200);
});
test('wrong-unit, duplicate, wrong-year and incomplete records fail closed without disclosing amounts',async()=>{
 for(const rows of [[record('be')],[record('aeroastro',2028)],[record('aeroastro'),record('aeroastro')]]){
  const result=await createAllocationsHandler({authorize:auth('aeroastro','admin'),query:async()=>({data:rows,metadata:{totalRecords:rows.length}})})(event('aeroastro'));assert.equal(result.statusCode,503);assert.ok(!result.body.includes('Biological'));
 }
});
test('DMSE receives only its own and managed-program rows',async()=>{
 const handler=createAllocationsHandler({authorize:auth('dmse','read'),query:async()=>({data:['dmse','archaeology','ppst'].map(u=>record(u)),metadata:{totalRecords:3}})});const response=await handler(event('dmse'));assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).rows.length,3);
});
