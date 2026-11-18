import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublishedHandler,normalizeReport} from './src/published-report.mjs';
import {createReportHandler} from './src/report-page.mjs';
import access from './src/access.cjs';
import policy from './src/policy.cjs';
const report=()=>({view:'all',period:'202704',retrieved:'2026-10-23T12:00:00-04:00',rows:[{key:'1234567',name:'Test',category:'',balance:'100',projected:'10',estimate:'20',after:'70',actual:'0',deans_discretionary:true,issues:[],details:[]}],issues:[]});
test('real role checks allow school readers to view but reserve refresh and publish for school administrators',async()=>{
 for(const [scope,role]of [['school','read'],['school','write'],['school','admin'],['school','limited_read'],['aeroastro','admin']]){
  const data=policy.initialPolicy();data.grants.push({username:'testuser',scope,role});
  const authorize=(event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'testuser'}),load:async()=>({data,etag:'test'})});
  const fn=createReportHandler(authorize),read=await fn({httpMethod:'GET'}),refresh=await fn({httpMethod:'GET',queryStringParameters:{refresh:'1'}});
  assert.equal(read.statusCode,scope==='school'&&!role.startsWith('limited_')?200:403);
  assert.equal(refresh.statusCode,scope==='school'&&role==='admin'?200:403);
  let reads=0;const endpoint=createPublishedHandler({authorize,store:async()=>{reads++;return {get:async()=>({schema:1,result:report()})};}});
  const response=await endpoint({httpMethod:'GET'});assert.equal(response.statusCode,read.statusCode);assert.equal(reads,read.statusCode===200?1:0);
  const publish=await authorize({},{scope:'school',minimum:'admin'});assert.equal(Boolean(publish.user),scope==='school'&&role==='admin');
 }
});
test('published reads and publishing enforce school scope and different capabilities before storage',async()=>{
 for(const method of ['GET','POST']){let reads=0;const fn=createPublishedHandler({authorize:async(event,options)=>{assert.equal(options.scope,'school');assert.equal(options.minimum,method==='GET'?'read':'admin');return {statusCode:403,body:'Denied'};},store:async()=>{reads++;}});assert.equal((await fn({httpMethod:method})).statusCode,403);assert.equal(reads,0);}
});
test('default report needs no local connection; refresh workspace requires school administrator',async()=>{
 const fn=createReportHandler(async(event,options)=>{assert.equal(options.minimum,event.queryStringParameters?.refresh==='1'?'admin':'read');return {user:{},admin:true};});
 const view=await fn({httpMethod:'GET',queryStringParameters:{view:'all'}});assert.match(view.body,/published-report.js/);assert.doesNotMatch(view.body,/id="connect"/);
 const backstage=await fn({httpMethod:'GET',queryStringParameters:{view:'all',refresh:'1'}});assert.match(backstage.body,/id="connect"/);assert.match(backstage.body,/id="publish"/);
});
test('publishing rejects selected reports, duplicate keys, missing flag metadata and nonfinite amounts',()=>{
 for(const mutate of [r=>r.view='custom',r=>r.rows.push({...r.rows[0]}),r=>delete r.rows[0].deans_discretionary,r=>r.rows[0].after='NaN']){const r=report();mutate(r);assert.throws(()=>normalizeReport(r));}
 const r=report();r.password='must not be persisted';assert.equal(normalizeReport(r).password,undefined);
});
test('publishing uses same-origin POST and conditional replacement; older reports cannot replace current',async()=>{
 const old=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://example.test';
 try{let saved=null,version=0;const store={getWithMetadata:async()=>saved?{data:saved,etag:String(version)}:null,get:async()=>saved,setJSON:async(key,value,options)=>{if(saved&&options.onlyIfMatch!==String(version))return {modified:false};saved=value;version++;return {modified:true};}};
 const fn=createPublishedHandler({authorize:async()=>({user:{},kerberos:'admin'}),store:async()=>store});
 const event=r=>({httpMethod:'POST',headers:{origin:process.env.APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify(r)});
 assert.equal((await fn({...event(report()),headers:{}})).statusCode,403);
 assert.equal((await fn(event(report()))).statusCode,200);
 const read=await fn({httpMethod:'GET'});assert.equal(JSON.parse(read.body).result.rows.length,1);assert.match(read.headers['Cache-Control'],/no-store/);
 const older=report();older.retrieved='2026-10-22T00:00:00Z';assert.equal((await fn(event(older))).statusCode,409);assert.equal(saved.result.retrieved,report().retrieved);
 }finally{if(old===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=old;}
});
