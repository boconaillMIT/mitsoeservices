import test from 'node:test';import assert from 'node:assert/strict';import {forecast,matching} from './public/aeroastro-finance-model.mjs';import {createFinanceHandler,FINANCE_SCOPE} from './src/aeroastro-finance.mjs';import {createFinanceRepository} from './src/aeroastro-finance-store.mjs';import policy from './src/policy.cjs';import features from './src/features.cjs';import {authorizationSummary} from './src/authorization-summary.cjs';
import {validateFinanceSource} from './src/aeroastro-finance-source.mjs';
const fake={user:{kerberos:'example'},kerberos:'example',canWrite:true,navigation:{},policy:{data:{grants:[]}}};
const event=(path,extra={})=>({path:'/units/aeroastro/finance/'+path,httpMethod:'GET',queryStringParameters:{},...extra});
test('AeroAstro finance is an explicit unit-specific grant, independent of unit write access',async()=>{
 const data=policy.validatePolicy({...policy.initialPolicy(),grants:[...policy.initialPolicy().grants,{username:'example',scope:'aeroastro',role:'read'},{username:'example',scope:FINANCE_SCOPE,role:'write'}]});
 assert.equal(policy.effectiveRole(data,'example',FINANCE_SCOPE),'write');assert.equal(policy.effectiveRole(data,'example','meche'),null);assert.equal(policy.effectiveRole(data,'example','school'),null);assert.equal(policy.effectiveRole(data,'example','rct'),null);assert.equal(policy.effectiveRole(data,'example','aeroastro'),'read');
 assert.match(authorizationSummary(data,'example').find(r=>r.scope===FINANCE_SCOPE).href,/aeroastro\/finance/);
 assert.equal(policy.effectiveRole({grants:[{username:'example',scope:'aeroastro',role:'admin'}]},'example',FINANCE_SCOPE),null);
 assert.equal(policy.effectiveRole({grants:[{username:'example',scope:'school',role:'write'}]},'example',FINANCE_SCOPE),null);assert.equal(policy.effectiveRole({grants:[{username:'example',scope:'school',role:'admin'}]},'example',FINANCE_SCOPE),'admin');
 assert.equal(features.featureFor(event('accounts')),'aeroastro-finance');
});
test('All finance endpoints check scope before loading source or notes; unsupported paths and mutations fail',async()=>{
 let reads=0;const h=createFinanceHandler({authorize:async(e,options)=>{assert.equal(options.scope,FINANCE_SCOPE);return {statusCode:403,body:'Denied'};},repository:()=>{reads++;throw Error();}});
 for(const p of ['accounts','people','data','notes'])assert.equal((await h(event(p))).statusCode,403);assert.equal(reads,0);
 assert.equal((await h(event('accounts',{httpMethod:'POST'}))).statusCode,405);assert.equal((await h({...event('accounts'),path:'/units/meche/finance/accounts'})).statusCode,404);
});
test('Read-only finance users cannot write notes, while note writers cannot edit account or salary data',async()=>{
 const h=createFinanceHandler({authorize:async(e,o)=>o.minimum==='write'?{statusCode:403,body:'Denied'}:{...fake,canWrite:false}});
 assert.equal((await h(event('notes',{httpMethod:'POST'}))).statusCode,403);
 for(const path of ['accounts','people','data'])assert.equal((await h(event(path,{httpMethod:'POST'}))).statusCode,405);
});
test('Projection subtracts future expense run rate from posted balance without subtracting commitments twice',()=>{
 const r=forecast({currentBalance:100000,ytdExpenses:36500,commitments:30000},'2026-09-30');assert.equal(r.elapsed,92);assert.equal(r.days,365);assert.equal(r.remaining,108309.78);assert.equal(r.projected,-8309.78);
 assert.equal(forecast({currentBalance:1000,ytdExpenses:0},'2026-09-30').projected,1000);assert.equal(forecast({currentBalance:1000,ytdExpenses:null},'2026-09-30').projected,null);
 assert.equal(forecast({currentBalance:1000,ytdExpenses:100},'2027-06-30').remaining,0);assert.equal(forecast({currentBalance:1000,ytdExpenses:-100},'2026-09-30').remaining,0);
 assert.equal(forecast({currentBalance:5000,ytdExpenses:100,history:[]},'2026-09-30','history').projected,null);assert.equal(forecast({currentBalance:5000,ytdExpenses:100,history:[{expenses:3650},{expenses:0},{expenses:3650}]},'2026-09-30','history').remaining,2730);
 assert.equal(forecast({currentBalance:1000,ytdExpenses:100},'2028-02-29').days,366);
});
test('Filters run across all records and missing financial amounts sort last in either direction',()=>{
 const rows=[{account:'9900003',name:'C',control:'DP',currentBalance:null},{account:'9900002',name:'B',control:'FC',currentBalance:-20},{account:'9900001',name:'A',control:'DP',currentBalance:100}];
 assert.deepEqual(matching(rows,{sort:'currentBalance',direction:-1}).map(r=>r.account),['9900001','9900002','9900003']);assert.deepEqual(matching(rows,{sort:'currentBalance',direction:1}).map(r=>r.account),['9900002','9900001','9900003']);assert.equal(matching(rows,{control:'DP',search:'9900001'}).length,1);
});
test('Personnel API removes sensitive HR fields and uses only the protected AeroAstro source',async()=>{
 const h=createFinanceHandler({authorize:async()=>fake,repository:()=>({snapshot:async kind=>({asOf:'2026-11-01',label:'Example roster',kind,rows:[{name:'Example Person',salary:100,position:'Example',MIT_ID:'not-for-browser',visa:'excluded',residency:'excluded',I9:'excluded'}]})})});
 const r=await h(event('data',{queryStringParameters:{view:'people'}}));assert.equal(r.statusCode,200);const d=JSON.parse(r.body);assert.deepEqual(d.rows,[{name:'Example Person',position:'Example',salary:100}]);assert.doesNotMatch(r.body,/not-for-browser|excluded/);
});
test('Account notes require a trusted account and same-origin JSON; authors and time are server-owned',async()=>{
 const old=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://example.test';let writes=[];const h=createFinanceHandler({authorize:async()=>fake,repository:()=>({snapshot:async()=>({rows:[{account:'9900001',name:'Example'}]}),append:async(...args)=>{writes.push(args);return {status:200};}})});
 const request=body=>event('notes',{httpMethod:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({account:'9900001',text:'Source statement',source:'Example email',operationId:'11111111-1111-4111-8111-111111111111',...body})});
 try{assert.equal((await h(request({by:'someone-else'}))).statusCode,400);assert.equal((await h(request({account:'9900002'}))).statusCode,404);assert.equal((await h({...request({}),headers:{Origin:'https://evil.example','Content-Type':'application/json'}})).statusCode,403);assert.equal((await h(request({}))).statusCode,200);assert.equal(writes.length,1);assert.equal(writes[0][1],'example');}finally{if(old===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=old;}
});
test('No current account source exposes no unverified accounts and no fabricated financials',async()=>{
 const h=createFinanceHandler({authorize:async()=>fake,repository:()=>({snapshot:async()=>null,notes:async()=>[]})});const r=await h(event('data'));const d=JSON.parse(r.body);assert.equal(r.statusCode,200);assert.equal(d.currentAvailable,false);assert.equal(d.canNote,false);assert.equal(d.source,null);assert.deepEqual(d.rows,[]);
});
test('Encrypted note records preserve concurrent append operations and provide idempotent retry',async()=>{
 const entries=[],key=Buffer.alloc(32,1),table='bexample';let addCount=0;const query=async(p,b)=>{const id=/\{6\.EX\.'([^']+)'\}/.exec(b.where)?.[1];const found=id?entries.filter(r=>r['6'].value===id):entries;return {data:found,metadata:{totalRecords:found.length}};};
 const add=async xml=>{addCount++;const f=id=>new RegExp('<field fid="'+id+'">([^<]*)</field>').exec(xml)[1];entries.push({'3':{value:entries.length+1},'6':{value:f(6)},'7':{value:f(7)},'8':{value:f(8)}});};
 const r=createFinanceRepository({query,add,table,key:()=>key,now:()=>new Date('2026-11-01T12:00:00Z')});
 const one={text:'One',source:'Example email',operationId:'11111111-1111-4111-8111-111111111111'},two={text:'Two',operationId:'22222222-2222-4222-8222-222222222222'};await Promise.all([r.append('9900001','first',one),r.append('9900001','second',two)]);assert.equal((await r.notes()).length,2);assert.equal((await r.append('9900001','first',one)).status,200);assert.equal(addCount,2);assert.equal((await r.append('9900001','other',one)).status,409);assert.equal((await r.notes())[0].at,'2026-11-01T12:00:00.000Z');
});
test('Source validation rejects foreign profit centers, duplicate accounts, unsafe HR fields and invalid dates',()=>{
 const source={schema:1,unit:'aeroastro',kind:'accounts',asOf:'2026-09-30',label:'Fictional source',rows:[{account:'9900001',profitCenter:'P061000',name:'Example',status:'Open',currentBalance:0,ytdExpenses:0,commitments:null}]};assert.equal(validateFinanceSource(source,'accounts'),source);
 assert.throws(()=>validateFinanceSource({...source,rows:[{...source.rows[0],profitCenter:'P062000'}]},'accounts'),/profit center/);assert.throws(()=>validateFinanceSource({...source,rows:[...source.rows,...source.rows]},'accounts'),/unique accounts/);assert.throws(()=>validateFinanceSource({...source,asOf:'2026-02-31'},'accounts'));assert.throws(()=>validateFinanceSource({...source,asOf:'2099-01-01'},'accounts'));
 const person={id:'1',name:'Example',startDate:null,endDate:null,openEnded:true,additionalAppointments:false,salary:5000,hourlyRate:null,fte:50};const roster={...source,kind:'people',rows:[person]};assert.equal(validateFinanceSource(roster,'people'),roster);assert.throws(()=>validateFinanceSource({...roster,rows:[{...person,visa:'not allowed'}]},'people'),/Unapproved/);assert.equal(forecast({...source.rows[0],status:'Closed'},source.asOf).projected,null);
});
