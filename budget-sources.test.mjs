import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeBudgetWorkbook,sourceTotals,compareBudgetSource} from './src/budget-source-model.mjs';
import {createBudgetSourceStore} from './src/budget-source-store.mjs';
import {createBudgetSourcesHandler} from './src/budget-sources.mjs';
import {mainNavigation} from './src/navigation.cjs';
const row=(n,values)=>({row:n,cells:Object.entries(values).map(([col,value])=>({cell:col+n,...(typeof value==='object'?value:{value:String(value),type:null,formula:null})}))});
const book=(sourceId,sheet,rows)=>({sourceId,name:'Example.xlsx',sha:'a'.repeat(64),sheets:[{name:sheet,rows,formulas:0}]});
test('working stages stay separate, exclude subtotal rows, and preserve missing versus zero',()=>{
 const b=book('fy28-working','FY28 Working Document ',[row(6,{B:'BE',C:'Example need',D:80,F:20,H:10,I:{value:'110',formula:'SUM(D6:H6)'},L:'BE',M:'Example need',S:{value:'0',formula:'SUM(N6:R6)'}}),row(7,{C:'Another need',F:0,I:0}),row(8,{B:'Total',I:110}),row(9,{B:'BE',C:'Subtotal',D:80,F:20})]);
 const ds=normalizeBudgetWorkbook(b).datasets,initial=ds.find(d=>d.id.endsWith('initial')),post=ds.find(d=>d.id.endsWith('post'));
 assert.equal(initial.rows.length,2);assert.equal(sourceTotals(initial.rows).requested.value,110);assert.equal(initial.rows[0].issues.length,0);assert.equal(initial.rows[1].school,0);assert.equal(initial.rows[1].provost,null);assert.equal(post.rows[0].reported,null);assert.equal(post.hasAmounts,false);
});
test('fiscal year comes from each source row, not the worksheet title; account references stay text',()=>{
 const b=book('fy27-sources','FY27 Budget approved',[row(2,{A:'Approved',B:2026,C:'BE',D:'Example',M:30,P:40,Q:20,S:90,U:'0012345',V:'0098765',W:'0000007'}),row(3,{A:'Approved',B:2027,C:'CEE',D:'Another',M:10,S:10})]);
 const ds=normalizeBudgetWorkbook(b).datasets;assert.equal(ds.length,2);const r=ds.find(d=>d.year===2026).rows[0];assert.match(r.issues[0],/worksheet name differs/);assert.equal(r.accounts.provost,'0012345');assert.equal(r.provost,70);assert.equal(r.funded,90);
});
test('distribution schedules retain both distributed and reference school amounts',()=>{
 const b=book('fy27-sources','FY27 Budget_APPROVED',[row(2,{A:'Approved',B:2027,C:'BE',M:'Example',D:20,E:5,T:30,V:25})]);
 const r=normalizeBudgetWorkbook(b).datasets[0].rows[0];assert.equal(r.school,20);assert.equal(r.scc,5);assert.equal(r.referenceSchool,30);assert.match(r.issues[0],/reference/);
});
test('TA totals use only the unit cost block, excluding potential source-account balances',()=>{
 const b=book('fy27-sources','FY26 TA source and accounts',[row(11,{B:'BE',C:2,G:40,H:20,I:60,J:55}),row(21,{B:'Totals:',G:40,H:20,I:60}),row(32,{B:'Potential funding account',G:999,H:999})]);
 const d=normalizeBudgetWorkbook(b).datasets[0];assert.equal(d.rows.length,1);assert.equal(sourceTotals(d.rows).school.value,20);assert.equal(d.rows[0].taCount,2);
});
test('FY21 proposed and funded decision blocks map independently',()=>{
 const b=book('fy21-decisions','Sheet1',[row(4,{A:'BE'}),row(5,{A:'Example',B:100,C:20,D:70,E:10,H:40,I:60,J:10,L:5,M:35})]);
 const ds=normalizeBudgetWorkbook(b).datasets;assert.equal(ds[0].rows[0].requested,120);assert.equal(ds[0].rows[0].provost,70);assert.equal(ds[0].rows[0].school,35);assert.equal(ds[1].rows[0].provost,80);
});
test('comparison restricts year and unit and uses requested amounts for working allocations',()=>{
 const r={unit:'AERO',unitKey:'aeroastro',requested:100,school:50};
 const c=compareBudgetSource({year:2028,kind:'working'},[r],[{year:2028,unit:'Aero-Astro',requested:90},{year:2027,unit:'AERO',requested:1000},{year:2028,unit:'BE',requested:2000}]);assert.equal(c.length,1);assert.equal(c[0].difference,10);assert.equal(sourceTotals([]).requested.value,null);
});
function fixture(){const f={'Source Key':6,'Source ID':7,'Snapshot SHA':8,Kind:9,'Payload JSON':10},payload=JSON.stringify({sheet:0,rows:[row(1,{A:'Example'})]}),sha='a'.repeat(64),key='example|'+sha+'|0|0',manifest={schema:1,sourceId:'example',sha,name:'Example.xlsx',sheets:[{name:'Sheet1',rowCount:1}],chunks:[{key,sha:createHash('sha256').update(payload).digest('hex')}]};
 const records=[{'Source Key':'manifest:example','Source ID':'example','Snapshot SHA':sha,Kind:'manifest','Payload JSON':JSON.stringify(manifest)},{'Source Key':key,'Source ID':'example','Snapshot SHA':sha,Kind:'data','Payload JSON':payload}];
 return {records,transport:{async rest(path,{body}={}){if(path.startsWith('fields?'))return Object.entries(f).map(([label,id])=>({label,id}));const selected=records.filter(r=>body.where.includes("EX.'manifest'")?r.Kind==='manifest':r.Kind==='data');return {metadata:{totalRecords:selected.length},data:selected.map(r=>Object.fromEntries(Object.entries(r).map(([k,value])=>[f[k],{value}])))};}}};}
test('snapshot store verifies every chunk hash and complete row count',async()=>{const x=fixture(),store=createBudgetSourceStore({transport:x.transport,table:'abcdefg'});assert.equal((await store.load())[0].sheets[0].rows.length,1);x.records[1]['Payload JSON']+=' ';await assert.rejects(store.load({fresh:true}),/integrity/);});
test('snapshot store fails closed when a referenced chunk is missing',async()=>{const x=fixture();x.records.pop();await assert.rejects(createBudgetSourceStore({transport:x.transport,table:'abcdefg'}).load(),/chunk count/);});
const event=(action='')=>({httpMethod:'GET',path:'/soe-hq/budget-sources'+(action?'/'+action:''),queryStringParameters:{}});
test('every source route requires school administrator access before reading data',async()=>{let loads=0;const handler=createBudgetSourcesHandler({authorize:async(e,opts)=>{assert.deepEqual(opts,{scope:'school',minimum:'admin'});return {statusCode:401,body:'Sign in'};},store:{load:async()=>{loads++;return [];}}});assert.equal((await handler(event())).statusCode,302);assert.equal((await handler(event('data'))).statusCode,401);assert.equal((await handler(event('worksheet'))).statusCode,401);assert.equal(loads,0);});
test('authorized source reads handle canonical feed outage and reject unknown sheets and writes',async()=>{const handler=createBudgetSourcesHandler({authorize:async()=>({user:{},admin:true,schoolAccess:true}),store:{load:async()=>[book('example','Sheet1',[])]},canonical:async()=>{throw Error('offline');}});const response=await handler(event('data'));assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).comparisonAvailable,false);assert.equal((await handler(event('worksheet'))).statusCode,404);assert.equal((await handler({...event('data'),httpMethod:'POST'})).statusCode,405);});
test('source analysis menu is visible only to school administrators',()=>{assert.match(mainNavigation({schoolAccess:true,schoolAdmin:true}),/budget-sources/);assert.doesNotMatch(mainNavigation({schoolAccess:true}),/budget-sources/);assert.doesNotMatch(mainNavigation({schoolAccess:false,schoolAdmin:true}),/budget-sources/);});
