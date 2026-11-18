import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const engineSource=await readFile(new URL('../sync_app/static/resource-data.js',import.meta.url),'utf8');
const sandbox={console,fetch,URL,Date,Map,Set,Error,Number,BigInt};
vm.runInNewContext(engineSource,sandbox);
const api=sandbox.SoeResourceData;
const statements=[
 {id:1,key:'2028|A',unit:'A',group:'Academic department',cycle:2028,base_year:2027,carry_year:2027,balance_year:2026,payout_year:2028,carry:90,balance:20,nonrecurring:110},
 {id:2,key:'2028|B',unit:'B',group:'Other unit',cycle:2028,base_year:2027,carry_year:2027,balance_year:2026,payout_year:2028,carry:10,balance:5,nonrecurring:15},
 {id:3,key:'2028|School',unit:'Total School of Engineering',group:'School total (reference)',cycle:2028,carry:100,balance:25,nonrecurring:125},
];
const rows=[
 {id:1,unit:'A',cycle:2028,type:'GIB Carryforward',year:2027,statement_id:1,account:'0123456',name:'Example',amount:100,admin:'DP',classification:'General'},
 {id:2,unit:'A',cycle:2028,type:'GIB Carryforward',year:2027,statement_id:1,account:'1234567',name:'Deficit',amount:-10,admin:'FC'},
 {id:3,unit:'A',cycle:2028,type:'GIB Carryforward',year:2027,statement_id:1,account:'7654321',name:'Missing',amount:null},
 {id:4,unit:'A',cycle:2028,type:'GIB Carryforward',year:2026,statement_id:1,account:'0123456',name:'Prior',amount:40},
 {id:5,unit:'B',cycle:2028,type:'GIB Carryforward',year:2027,statement_id:2,account:'7777777',name:'Other unit',amount:10},
];
const config={realm:'mit.quickbase.com',accounts:'accounts',statements:'statements',details:'details',academicUnits:['A'],
 summaryFields:{3:'id',6:'key',7:'unit',9:'cycle',11:'base_year',13:'carry_year',17:'balance_year',21:'payout_year',14:'carry',18:'balance',24:'nonrecurring',33:'group'},
 detailFields:{3:'id',8:'unit',10:'cycle',11:'type',12:'year',15:'amount',19:'account',20:'name',23:'admin',28:'classification',37:'statement_id'}};
function raw(rows,fields){return rows.map(r=>Object.fromEntries(Object.entries(fields).map(([fid,label])=>[fid,{value:r[label]??null}])));}
function fakeQB({deny,limited=false}={}){
 const calls=[];
 const fetchImpl=async(url,options={})=>{
   calls.push({url,options});
   if(url.includes('/auth/temporary/')){
      const table=url.split('/').at(-1);
      return table===deny?new Response('{}',{status:403}):Response.json({temporaryAuthorization:'viewer-'+table});
   }
   assert.equal(url,'https://api.quickbase.com/v1/records/query');
   const body=JSON.parse(options.body);assert.equal(options.headers.Authorization,'QB-TEMP-TOKEN viewer-'+body.from);
   const visibleStatements=limited?statements.slice(0,1):statements;
   const visibleRows=limited?rows.filter(r=>r.statement_id===1):rows;
   let data=body.from==='statements'?raw(visibleStatements,config.summaryFields):body.from==='details'?raw(visibleRows,config.detailFields):[{'3':{value:1}}];
   const total=data.length;data=data.slice(body.options?.skip||0,(body.options?.skip||0)+(body.options?.top||1000));
   return Response.json({data,metadata:{totalRecords:total}});
 };
 return {calls,fetchImpl};
}

test('resource dashboard uses viewer-session credentials and only read endpoints',async()=>{
 const mock=fakeQB(),client=api.createClient(config,{fetchImpl:mock.fetchImpl});
 const overview=await client.overview('academic');assert.equal(overview.units.length,1);assert.equal(overview.totals.nonrecurring,110);
 const detail=await client.detail({group:'academic'});assert.equal(detail.sum,90);assert.equal(detail.blank_count,1);assert.equal(detail.count,3);
 assert.ok(mock.calls.filter(c=>c.url.includes('/auth/temporary/')).every(c=>c.options.credentials==='include'));
 assert.ok(mock.calls.every(c=>!JSON.stringify(c.options).includes('QB-USER-TOKEN')));
 assert.ok(mock.calls.every(c=>c.url.includes('/auth/temporary/')||c.url.endsWith('/records/query')));
});
test('denied Finance table, statements, or detail permissions block the dashboard',async()=>{
 for(const deny of ['accounts','statements','details']){
  const mock=fakeQB({deny}),client=api.createClient(config,{fetchImpl:mock.fetchImpl});
  await assert.rejects(()=>client.overview('academic'),/Quickbase has denied access/);
  assert.ok(!mock.calls.some(c=>c.url.endsWith('/records/query')&&JSON.parse(c.options.body).select.includes(14)));
 }
});
test('role-filtered responses do not acquire records from a shared service account',async()=>{
 const mock=fakeQB({limited:true}),client=api.createClient(config,{fetchImpl:mock.fetchImpl});
 const all=await client.overview('all');assert.equal(all.units.length,1);assert.equal(all.totals.nonrecurring,110);assert.equal(all.reference,null);
 assert.equal((await client.detail({group:'all'})).sum,90);
 await assert.rejects(()=>client.detail({group:'all',unit:'2'}),/Quickbase has denied access/);
});

test('Budget dashboard gates on Budget access and wallet permissions',async()=>{
 const budgetConfig={...config,accounts:undefined,accessTable:'budget'};
 const mock=fakeQB(),client=api.createClient(budgetConfig,{fetchImpl:mock.fetchImpl});
 assert.equal((await client.overview('all')).units.length,2);
 assert.ok(mock.calls.some(c=>c.url.endsWith('/auth/temporary/budget')));
 assert.ok(!mock.calls.some(c=>c.url.endsWith('/auth/temporary/accounts')));
 const denied=fakeQB({deny:'budget'});
 await assert.rejects(()=>api.createClient(budgetConfig,{fetchImpl:denied.fetchImpl}).overview('all'),/Quickbase has denied access/);
});
test('groups exclude school rollup and preserve blanks, deficits, period and exact totals',()=>{
 assert.equal(api.makeOverview(statements,'all').totals.nonrecurring,125);
 assert.equal(api.makeOverview(statements,'other').units.length,1);
 const base=api.parseFilters({});const detail=api.buildDetail(rows,statements,base);
 assert.equal(detail.rows.at(-1).amount,null);assert.equal(detail.sum,90);assert.equal(detail.trend[2].amount,40);
 assert.equal(api.buildDetail(rows,statements,api.parseFilters({show:'negative'})).sum,-10);
 assert.equal(api.buildDetail(rows,statements,api.parseFilters({show:'blank'})).sum,null);
 assert.equal(api.sum([.1,.2,-.05]),.25);assert.equal(api.sum([1,null]),null);
});
test('pagination and safe exports retain all matching records',()=>{
 const many=Array.from({length:150},(_,i)=>({...rows[0],id:i+1,account:String(1000000+i)}));
 const f=api.parseFilters({page:2});assert.equal(api.buildDetail(many,statements,f).rows.length,50);assert.equal(api.buildDetail(many,statements,f,true).rows.length,150);
 const csv=api.csv([{...rows[0],name:'=danger',amount:-10}]);assert.match(csv,/'=danger/);assert.match(csv,/"-10"/);assert.match(csv,/0123456/);
 for(const input of [{unit:"1'}OR{3.GT.'0"},{type:'bad'},{year:2028},{group:'bad'}])assert.throws(()=>api.parseFilters(input));
});
test('published shell contains code only and no localhost or service credentials',async()=>{
 const html=await readFile(new URL('../carryover-fy28/academic-resources.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/127\.0\.0\.1|localhost|QB-USER-TOKEN|fetch\(`\/resources\/data/);
 assert.match(html,/auth\/temporary\//);assert.match(html,/QB-TEMP-TOKEN/);assert.match(html,/Your Quickbase permissions apply/);
 assert.match(html,/p\.set\('a','dbpage'\)/);assert.match(html,/p\.set\('pageID',"2"\)/);
 assert.match(html,/accessTable":"br8dehttq/);assert.doesNotMatch(html,/br2xvzd7a|br2xvsvpw/);
 assert.doesNotMatch(html,/533988097|767591994|439468893/);
});

test('control splits retain negatives, blanks and unclassified records independently of filters',()=>{
 const controlled=[{...rows[0],amount:12.34},{...rows[1],amount:5.66},{...rows[0],amount:2,admin:null}];
 assert.deepEqual(JSON.parse(JSON.stringify(api.controlTotals(controlled))),{department:12.34,faculty:5.66,unclassified:2});
 assert.deepEqual(JSON.parse(JSON.stringify(api.controlTotals([]))),{department:null,faculty:null,unclassified:null});
 assert.equal(api.controlTotals([{...rows[0],amount:null}]).department,null);
 assert.equal(api.controlTotals([{...rows[0],amount:12.34},{...rows[0],amount:null}]).department,12.34);
 assert.equal(api.controlTotals([{...rows[1],amount:-10}]).faculty,-10);
 const detail=api.buildDetail(controlled,statements,api.parseFilters({unit:'1',admin:'DP'}));
 assert.equal(detail.controls.department,12.34);assert.equal(detail.controls.faculty,0);
 assert.equal(detail.trend.at(-1).controls.faculty,5.66);
 const enriched=api.addBalanceControls([{...statements[0],department_carry:60,faculty_carry:30}],controlled.map(r=>({...r,type:'Expendable Fund Balance',year:2026})));
 assert.equal(enriched[0].department_balance,12.34);assert.equal(enriched[0].department_nonrecurring,72.34);
 assert.equal(enriched[0].unclassified_balance,2);
 const overview=api.makeOverview(enriched,'academic');assert.equal(overview.totals.department_nonrecurring,72.34);
 assert.ok(api.csv(enriched,true).includes('department_balance'));
});
