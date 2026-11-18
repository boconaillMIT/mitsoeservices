import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeStatements,trend,loadReserves,createReservesHandler,GENERAL} from './src/reserves.mjs';
import {createMcpHandler} from './src/mcp-server.mjs';
import units from './src/units.cjs';

const row=(type,year,account,amount,admin='DP',classification=GENERAL,extra={})=>({type,year,account,amount,admin,classification,projection:false,...extra});
// Two accounts: one general (DP), one restricted (DP), one faculty (FC).
const rows=[
 row('GIB Base',2024,'1',1200),row('GIB Base',2025,'1',1200),row('GIB Base',2026,'1',1200),
 row('GIB Carryforward',2024,'1',100),row('GIB Carryforward',2025,'1',300),row('GIB Carryforward',2026,'1',500),row('GIB Carryforward',2027,'1',800),
 row('GIB Carryforward',2027,'9',50,'FC'),
 row('Expendable Fund Balance',2024,'2',600),row('Expendable Fund Balance',2025,'2',700),row('Expendable Fund Balance',2026,'2',1000),
 row('Expendable Fund Balance',2026,'3',5000,'DP','Professorships'),
 row('Expendable Fund Balance',2026,'4',2000,'FC','Department - general'),
 row('Pool A Payout',2026,'2',120,''),row('Pool A Payout',2026,'3',400,''),row('Pool A Payout',2028,'2',999,'',GENERAL,{projection:true})
];

test('reserve = DP general balance + DP GIB carried out; restricted and faculty kept separate',()=>{
 const y=summarizeStatements([{rows}]),fy26=y.find(r=>r.year===2026);
 assert.deepEqual(y.map(r=>r.year),[2024,2025,2026]);
 assert.equal(fy26.general,1000);assert.equal(fy26.gib_carry,800);assert.equal(fy26.reserve,1800);
 assert.equal(fy26.restricted,5000,'professorship balance is restricted');assert.equal(fy26.faculty,2050,'faculty balance + faculty GIB carry');
 assert.equal(fy26.payout_general,120,'payout only on DP general accounts; projections ignored');
 assert.equal(fy26.resources,1320);assert.equal(fy26.months,16.4);
 assert.equal(fy26.gib_used,900,'1200 base + 500 carried in - 800 carried out');assert.equal(fy26.gib_use_rate,0.529);
});
test('trend is change per year as a share of latest resources',()=>{
 const t=trend(summarizeStatements([{rows}]));assert.equal(t.from,2024);assert.equal(t.to,2026);assert.equal(t.change,1800-900);assert.equal(t.per_year_pct_of_resources,Math.round(900/2/1320*1000)/1000);
});
test('years without the following carryforward are not reported',()=>{
 assert.deepEqual(summarizeStatements([{rows:rows.filter(r=>!(r.type==='GIB Carryforward'&&r.year===2027))}]).map(r=>r.year),[2024,2025]);
});

const payload=scope=>{const w=units.WALLETS[scope];return {schema:1,scope,published_at:'2026-11-01T00:00:00Z',statement:{id:'7',unit:w.source,status:'Verified',cycle:2028},rows:rows.map(r=>({...r,statement_id:'7',unit:w.source,cycle:2028}))};};
test('loadReserves combines managed wallets, survives QuickBase outages and reports gaps',async()=>{
 const read=async scope=>scope==='nse'?null:payload(scope);
 const r=await loadReserves({group:'academic',read,query:async()=>{throw Error('down');},budget:async()=>{throw Error('down');}});
 const dmse=r.units.find(u=>u.scope==='dmse'),nse=r.units.find(u=>u.scope==='nse'),aa=r.units.find(u=>u.scope==='aeroastro');
 assert.equal(dmse.years.find(y=>y.year===2026).reserve,3*1800,'DMSE + PPSM + Archaeology wallets');
 assert.equal(aa.years.find(y=>y.year===2026).reserve,1800);
 assert.deepEqual(nse.years,[]);assert.deepEqual(nse.missing_wallets,['nse']);
 assert.equal(aa.open_commitments,null);assert.equal(aa.ask,null);
 assert.ok(r.notes.some(n=>/Commitments could not be read/.test(n)));assert.ok(r.notes.some(n=>/Budget requests could not be read/.test(n)));
 assert.ok(!r.units.some(u=>u.scope==='soe-fake'));
});
test('latest-year asks are matched to units by canonical name',async()=>{
 const budget=async()=>({selected:[{id:6,label:'Budget Fiscal Year'},{id:7,label:'Department'},{id:8,label:'Non-recurring (non-base) - DLC'}],raw:[
  {6:{value:'2028'},7:{value:'Aero-Astro'},8:{value:500}},{6:{value:'2028'},7:{value:'PPSM'},8:{value:70}},{6:{value:'2027'},7:{value:'EECS'},8:{value:900}},{6:{value:'2028'},7:{value:'Mystery Lab'},8:{value:5}}]});
 const r=await loadReserves({read:async s=>payload(s),query:async()=>{throw Error('x');},budget});
 assert.equal(r.ask_year,2028);assert.equal(r.units.find(u=>u.scope==='aeroastro').ask,500);assert.equal(r.units.find(u=>u.scope==='dmse').ask,70);assert.equal(r.units.find(u=>u.scope==='eecs').ask,0);
 assert.ok(r.notes.some(n=>/Mystery Lab/.test(n)));
});
test('reserves endpoint: administrators only, nothing loaded otherwise; respects hidden wallets',async()=>{
 let loaded=false;const load=async()=>{loaded=true;return {units:[]};};
 assert.equal((await createReservesHandler({authorize:async()=>({statusCode:403}),load})({httpMethod:'GET'})).statusCode,403);assert.equal(loaded,false);
 assert.equal((await createReservesHandler({authorize:async()=>({user:{},features:{wallets:false}}),load})({httpMethod:'GET'})).statusCode,403);assert.equal(loaded,false);
 const ok=await createReservesHandler({authorize:async()=>({user:{},features:{}}),load})({httpMethod:'GET',queryStringParameters:{refresh:'1'}});assert.equal(ok.statusCode,200);assert.equal(loaded,true);
});
test('connector exposes reserves read-only and filters by unit',async()=>{
 const h=createMcpHandler({auth:async()=>({kerberos:'oconaill'}),reserves:async()=>({units:[{scope:'eecs',label:'EECS',name:'Electrical Engineering & Computer Science'},{scope:'cee',label:'CEE',name:'Civil & Environmental Engineering'}]}),log:()=>{}});
 const r=await (await h(new Request('https://x/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'unit_reserves',arguments:{unit:'eecs'}}})}))).json();
 assert.deepEqual(r.result.structuredContent.units.map(u=>u.scope),['eecs']);
});
