import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createDrHandler} from './src/donation-requests.mjs';
import {cleanRequest} from './public/dr-model.mjs';
const at='2026-11-26T15:00:00.000Z',origin='https://example.test';
function record(){return {id:randomUUID(),revision:randomUUID(),owner:'studentx',createdBy:'studentx',status:'draft',departmentSource:'directory',request:cleanRequest({requesterName:'Test Student',requesterEmail:'studentx@mit.edu',department:'Test',organization:'Fictional club'}),organizationId:null,files:[],history:[],validity:null,finance:null,createdAt:at,updatedAt:at};}
function harness({login='studentx',grants=[],records=[record()]}={}){const rows=new Map(records.map(r=>[r.id,r]));let listScope,uploads=0;
 const auth={user:{kerberos:login,name:'Test Student',email:login+'@mit.edu',department:'Test'},kerberos:login,policy:{data:{grants}},navigation:{}};
 const store={async get(id){return rows.get(id)||null;},async list(scope){listScope=scope;return [...rows.values()].filter(r=>!scope.owner||r.owner===scope.owner);},async organizations(){return [];},async organization(name){return {id:randomUUID(),name};},async create(r){rows.set(r.id,r);return r;},async save(r){rows.set(r.id,r);return r;},async upload(){uploads++;return randomUUID();},async download(){throw Error('Not reachable');}};
 return {rows,auth,store,handler:createDrHandler({authorize:async()=>auth,store,origin:()=>origin}),get scope(){return listScope;},get uploads(){return uploads;}};
}
const event=(action='data',body,extra={})=>({path:'/donation-requests/'+action,httpMethod:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),...extra});
test('DR grants are separate from school and RCT grants; managers control only DR',()=>{
 for(const scope of ['school','rct'])for(const role of ['read','write'])assert.equal(policy.effectiveRole({grants:[{username:'person',scope,role}]},'person','dr'),null);
 const grants=[{username:'person',scope:'dr',role:'admin'}];assert.deepEqual(policy.managedScopes({grants},'person'),['dr']);assert.equal(policy.effectiveRole({grants},'person','school'),null);assert.equal(policy.effectiveRole({grants:[{username:'person',scope:'school',role:'admin'}]},'person','dr'),'admin');
});
test('signed-in requester has self-service access without any grants and gains no financial access',async()=>{
 const options={reader:async()=>({kerberos:'studentx'}),load:async()=>({data:{schema:2,grants:[],audit:[]}}),loadFeatures:async()=>({data:{}})};
 const own=await access.authorize({path:'/donation-requests'},{...options,scope:'dr-requester'});assert.equal(own.kerberos,'studentx');assert.equal(own.schoolAccess,false);assert.equal(own.canWrite,false);
 for(const scope of ['school','dr','rct','meche'])assert.equal((await access.authorize({}, {...options,scope})).statusCode,403);
});
test('unsigned page redirects to MIT sign-in and API refuses anonymous requests',async()=>{
 const handler=createDrHandler({authorize:async()=>({statusCode:401,body:'MIT sign-in required.'})});assert.equal((await handler(event('page'))).statusCode,302);assert.equal((await handler(event())).statusCode,401);assert.equal((await handler(event('attachment'))).statusCode,401);
});
test('requester queries are owner-scoped and copied request IDs cannot be edited or downloaded',async()=>{
 const h=harness({login:'outsider'}),r=[...h.rows.values()][0];assert.equal(JSON.parse((await h.handler(event())).body).records.length,0);assert.deepEqual(h.scope,{owner:'outsider'});
 assert.equal((await h.handler(event('data',{action:'withdraw',id:r.id,revision:r.revision}))).statusCode,404);
 assert.equal((await h.handler(event('attachment',null,{queryStringParameters:{id:r.id,file:randomUUID()}}))).statusCode,404);
});
test('staff readers see queue but cannot change other requesters records',async()=>{
 const h=harness({login:'reader',grants:[{username:'reader',scope:'dr',role:'read'}]}),r=[...h.rows.values()][0],data=JSON.parse((await h.handler(event())).body);assert.equal(data.staff,true);assert.equal(data.canWrite,false);assert.equal(data.records.length,1);assert.equal((await h.handler(event('data',{action:'note',id:r.id,revision:r.revision,message:'Note'}))).statusCode,403);
});
test('revoking a DR grant applies to the same authenticated session on its next request',async()=>{
 const grants=[{username:'reviewer',scope:'dr',role:'write'}],h=harness({login:'reviewer',grants});assert.equal(JSON.parse((await h.handler(event())).body).records.length,1);grants.splice(0);assert.equal(JSON.parse((await h.handler(event())).body).records.length,0);
});
test('writes reject foreign origins, wrong content types, stale revisions and forged approval stamps',async()=>{
 const h=harness(),r=[...h.rows.values()][0];for(const headers of [{Origin:'https://foreign.test','Content-Type':'application/json'},{Origin:origin,'Content-Type':'text/plain'}])assert.equal((await h.handler(event('data',{action:'withdraw',id:r.id,revision:r.revision},{headers}))).statusCode,403);
 assert.equal((await h.handler(event('data',{action:'withdraw',id:r.id,revision:'stale'}))).statusCode,409);
 const saved=await h.handler(event('data',{action:'save',id:r.id,revision:r.revision,request:{...r.request,title:'Updated',requesterName:'Spoof'},validity:{by:'administrator'}}));assert.equal(saved.statusCode,200);const next=JSON.parse(saved.body).record;assert.equal(next.request.requesterName,'Test Student');assert.equal(next.validity,null);
});
test('request creation retries reuse the same ID; owner is session-derived',async()=>{
 const h=harness({records:[]}),id=randomUUID(),command={action:'create',id,requesterName:'Spoof'};assert.equal((await h.handler(event('data',command))).statusCode,201);assert.equal((await h.handler(event('data',command))).statusCode,200);assert.equal(h.rows.size,1);assert.equal(h.rows.get(id).request.requesterName,'Test Student');
 assert.equal((await h.handler(event('data',{action:'create',id:randomUUID(),owner:'someoneelse'}))).statusCode,403);
});
test('attachment validation happens before upload; internal correspondence cannot be uploaded by requester',async()=>{
 const h=harness(),r=[...h.rows.values()][0],base={action:'attach',id:r.id,revision:r.revision,kind:'budget',filename:'budget.pdf',content:Buffer.from('not a pdf').toString('base64')};assert.equal((await h.handler(event('data',base))).statusCode,400);assert.equal(h.uploads,0);
 assert.equal((await h.handler(event('data',{...base,kind:'correspondence'}))).statusCode,403);assert.equal(h.uploads,0);
 const valid=await h.handler(event('data',{...base,content:Buffer.from('%PDF-1.7\n fictional budget').toString('base64')}));assert.equal(valid.statusCode,200);assert.equal(h.uploads,1);
});
test('attachment endpoints recheck membership and detect changed file bytes',async()=>{
 const h=harness(),r=[...h.rows.values()][0],file=randomUUID(),content=Buffer.from('%PDF-1.7 test');r.files=[{id:file,kind:'budget',filename:'test.pdf',sha256:createHash('sha256').update(content).digest('hex')}];h.store.download=async()=>({filename:'test.pdf',content:content.toString('base64')});
 let result=await h.handler(event('attachment',null,{queryStringParameters:{id:r.id,file}}));assert.equal(result.statusCode,200);assert.match(result.headers['Content-Disposition'],/attachment/);
 r.files[0].kind='correspondence';assert.equal((await h.handler(event('attachment',null,{queryStringParameters:{id:r.id,file}}))).statusCode,404);r.files[0].kind='budget';h.store.download=async()=>({filename:'test.pdf',content:Buffer.from('%PDF-1.7 changed').toString('base64')});assert.equal((await h.handler(event('attachment',null,{queryStringParameters:{id:r.id,file}}))).statusCode,503);
});
test('ordinary requesters receive no review search or staff navigation on either entry page',async()=>{
 const h=harness();for(const route of ['page','request']){const result=await h.handler(event(route));assert.equal(result.statusCode,200);assert.match(result.body,/data-dr-view="requester"/);for(const control of ['id="dr-search"','id="dr-filter"','id="dr-year"','id="dr-dept"','href="\/my-authorizations"','href="\/soe-hq"'])assert(!result.body.includes(control),control);assert.match(result.body,/Only requests belonging to your MIT login/);}
});
test('staff review retains search and offers a dedicated requester link',async()=>{
 const h=harness({login:'reviewer',grants:[{username:'reviewer',scope:'dr',role:'write'}]}),result=await h.handler(event('page'));
 assert.match(result.body,/data-dr-view="review"/);assert.match(result.body,/id="dr-search"/);assert.match(result.body,/href="\/donation-requests\/request"/);
 const limited=await h.handler(event('request'));assert.match(limited.body,/data-dr-view="requester"/);assert(!limited.body.includes('id="dr-search"'));assert(!limited.body.includes('href="/my-authorizations"'));
});
test('requester mode limits even a DR writer to owned requests and redacts staff details',async()=>{
 const own=record(),other=record();own.owner='reviewer';own.finance={amount:10,costObject:'SECRET-COST',by:'another',at};own.request.correspondence='SECRET-CORRESPONDENCE';own.history=[{action:'note',message:'SECRET-NOTE',internal:true}];
 const h=harness({login:'reviewer',grants:[{username:'reviewer',scope:'dr',role:'write'}],records:[own,other]}),queryStringParameters={view:'requester'},limited=JSON.parse((await h.handler(event('data',null,{queryStringParameters}))).body);
 assert.equal(limited.staff,false);assert.equal(limited.canWrite,false);assert.equal(limited.records.length,1);assert.equal(limited.records[0].id,own.id);assert.deepEqual(h.scope,{owner:'reviewer'});
 for(const secret of ['SECRET-COST','SECRET-CORRESPONDENCE','SECRET-NOTE'])assert(!JSON.stringify(limited).includes(secret));
 assert.equal((await h.handler(event('data',{action:'note',id:own.id,revision:own.revision,message:'Private'},{queryStringParameters}))).statusCode,403);
 assert.equal((await h.handler(event('data',{action:'create',id:randomUUID(),owner:'studentx'},{queryStringParameters}))).statusCode,403);
 assert.equal((await h.handler(event('attachment',null,{queryStringParameters:{...queryStringParameters,id:other.id,file:randomUUID()}}))).statusCode,404);
 assert.equal(JSON.parse((await h.handler(event('data'))).body).records.length,2);
});
test('the shareable requester link survives the MIT sign-in redirect',async()=>{
 const handler=createDrHandler({authorize:async()=>({statusCode:401,body:'MIT sign-in required.'})}),result=await handler(event('request'));
 assert.equal(result.statusCode,302);assert.equal(new URL(result.headers.Location,origin).searchParams.get('returnTo'),'/donation-requests/request');
});
test('a former staff creator cannot retrieve someone else’s request through a creation retry',async()=>{
 const prior=record();prior.createdBy='formerwriter';const h=harness({login:'formerwriter',records:[prior]});
 assert.equal((await h.handler(event('data',{action:'create',id:prior.id}))).statusCode,404);
});
