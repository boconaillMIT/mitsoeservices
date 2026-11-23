// Reserves vs. spending: department general balances and GIB carryforward relative to its
// annual discretionary resources, whether that reserve is growing, how much of each year's
// General Institute Budget (GIB) it actually used, and what it is asking for in FY28.
//
// Source: each unit's verified wallet statement (the same published snapshot the wallet pages use).
// Conventions in the statement (checked against AeroAstro's FY28-cycle statement):
//  - "GIB Carryforward" year Y = unspent GIB carried INTO fiscal year Y (i.e. FY(Y-1) year-end).
//  - "Expendable Fund Balance" year Y = FY Y year-end balance, tagged with a classification.
//  - "GIB Base" year Y = FY Y base allocation. "Pool A Payout" year Y = FY Y endowment payout.
// Definitions (year-end FY Y):
//  discretionary reserve = department-controlled (DP) "Department - general" expendable balance
//                          + DP GIB carried into FY Y+1
//  annual discretionary resources = DP GIB base FY Y + Pool A payout FY Y on DP "Department - general" accounts
//  months of reserve = reserve / (annual resources / 12)
//  GIB used FY Y = DP base Y + DP carry into Y - DP carry into Y+1; use rate = used / (base + carry in)
// Faculty-controlled (FC) funds and restricted department funds are reported separately.
import access from './access.cjs';
import units from './units.cjs';
import nameMapping from './unit-name-mapping.cjs';
import {readUnit,validPayload} from './unit-data.mjs';
import {loadCommitments,unpaidClassification} from './unit-commitments.mjs';
import {loadBudgetRecords,safeValue} from './budget-explorer.mjs';
import {mapRecord} from '../public/budget-model.mjs';
import {qbRequest} from './nimbus-store.mjs';

export const GENERAL='Department - general';
const amt=v=>typeof v==='number'&&Number.isFinite(v)?v:(typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):0);
const round=v=>v===null||!Number.isFinite(v)?null:Math.round(v);

// One unit = its own wallet plus any managed wallets (e.g. DMSE + PPSM + Archaeology).
export function summarizeStatements(payloads){
 const rows=payloads.flatMap(p=>p.rows).filter(r=>!r.projection);// closed accounts are kept: historical balances must include accounts that existed then
 const acct=new Map();// account -> {admin, classification} from balance rows
 for(const r of rows)if(r.type==='Expendable Fund Balance'&&r.account&&!acct.has(r.account))acct.set(r.account,{admin:r.admin,classification:r.classification||''});
 const pick=(type,year,test=()=>true)=>rows.filter(r=>r.type===type&&Number(r.year)===year&&test(r)).reduce((s,r)=>s+amt(r.amount),0);
 const has=(type,year)=>rows.some(r=>r.type===type&&Number(r.year)===year);
 const balYears=[...new Set(rows.filter(r=>r.type==='Expendable Fund Balance').map(r=>Number(r.year)))].sort();
 const years=[];
 for(const y of balYears){
  if(!has('GIB Carryforward',y+1))continue;// need the carry out of FY y
  const dp=r=>r.admin==='DP',fc=r=>r.admin==='FC';
  const general=pick('Expendable Fund Balance',y,r=>dp(r)&&r.classification===GENERAL);
  const restricted=pick('Expendable Fund Balance',y,r=>dp(r)&&r.classification!==GENERAL);
  const fcBalance=pick('Expendable Fund Balance',y,fc);
  const carryOut=pick('GIB Carryforward',y+1,dp),carryIn=has('GIB Carryforward',y)?pick('GIB Carryforward',y,dp):null;
  const fcCarryOut=pick('GIB Carryforward',y+1,fc);
  const base=pick('GIB Base',y,dp);
  const payout=pick('Pool A Payout',y,r=>{const a=acct.get(r.account);return a?.admin==='DP'&&a.classification===GENERAL;});
  const resources=base+payout,reserve=general+carryOut,available=carryIn===null?null:base+carryIn;
  years.push({year:y,reserve:round(reserve),general:round(general),gib_carry:round(carryOut),restricted:round(restricted),
   faculty:round(fcBalance+fcCarryOut),gib_base:round(base),payout_general:round(payout),resources:round(resources),
   months:resources>0?Math.round(reserve/(resources/12)*10)/10:null,
   gib_used:available===null?null:round(available-carryOut),gib_use_rate:available>0?Math.round((available-carryOut)/available*1000)/1000:null});
 }
 return years;
}

export function trend(years){
 if(years.length<2)return null;
 const first=years[0],last=years[years.length-1],span=last.year-first.year;
 if(!span||!(last.resources>0))return null;
 return {from:first.year,to:last.year,change:round(last.reserve-first.reserve),per_year_pct_of_resources:Math.round((last.reserve-first.reserve)/span/last.resources*1000)/1000};
}

export const GROUPS=['academic','other','all'];
export async function unitScopes(group){const all=Object.keys(units.ALL_UNITS).filter(k=>k!=='soe-fake'),academic=k=>Object.hasOwn(units.UNITS,k);
 return group==='all'?all:group==='other'?all.filter(k=>!academic(k)):all.filter(academic);}

export async function loadReserves({group='academic',read=readUnit,query=qbRequest,budget=loadBudgetRecords}={}){
 const scopes=await unitScopes(group),notes=[];
 const statements=await Promise.all(scopes.map(async scope=>{
  const wallets=units.walletsForUnit(scope);
  const payloads=(await Promise.all(wallets.map(async w=>{try{const p=await read(w);return validPayload(p,w)?p:null;}catch{return null;}}))).filter(Boolean);
  return {scope,payloads,missing:wallets.filter((w,i)=>!payloads.some(p=>p.scope===w))};
 }));
 let commitments=null;
 try{const data=await loadCommitments(query,'all');commitments={};let unassigned=0,incomplete=0;
  for(const c of data.commitments.map(c=>unpaidClassification(c,data.payments))){if(c.archived)continue;if(!c.unit){unassigned++;continue;}const scope=units.permissionScope(c.unit);const e=commitments[scope]||={unpaid:0,count:0,incomplete:0};e.count++;if(c.unpaid===null){e.incomplete++;incomplete++;}else e.unpaid+=c.unpaid;}
  if(unassigned)notes.push(unassigned+' unpaid SoE support commitments are not assigned to a unit.');
  if(incomplete)notes.push(incomplete+' unpaid SoE support commitments have incomplete amounts or payments.');
 }catch(e){console.error('Reserves: commitments unavailable:',e.message);notes.push('Unpaid SoE support could not be read from QuickBase; wallet balances are unchanged.');}
 let asks=null,askYear=null;
 try{const {selected,raw}=await budget();const rows=raw.map(r=>mapRecord(Object.fromEntries(selected.map(f=>[f.label,safeValue(r[String(f.id)]?.value)])))).filter(r=>!r.facultyHireSlot);
  askYear=Math.max(...rows.map(r=>r.year).filter(Number.isInteger));asks={};const unmatched=new Set();
  for(const r of rows.filter(r=>r.year===askYear)){const scope=nameMapping.scopeFor(r.unit),parent=scope?units.permissionScope(scope):null;if(!parent){if(r.requested)unmatched.add(r.unit||'(blank)');continue;}asks[parent]=(asks[parent]||0)+(r.requested||0);}
  if(unmatched.size)notes.push('FY'+String(askYear).slice(-2)+' requests not matched to a unit: '+[...unmatched].join(', ')+'.');
 }catch(e){console.error('Reserves: budget requests unavailable:',e.message);notes.push('Budget requests could not be read from QuickBase; request sizes are not shown.');}
 const result=statements.map(({scope,payloads,missing})=>{
  const u=units.ALL_UNITS[scope],years=payloads.length?summarizeStatements(payloads):[];
  const published=payloads.map(p=>p.published_at).sort().pop()||null;
  return {scope,label:u.label,name:u.name,academic:Object.hasOwn(units.UNITS,scope),statement_published_at:published,missing_wallets:missing,
   years,trend:trend(years),open_commitments:commitments?round(commitments[scope]?.unpaid||0):null,open_commitment_count:commitments?(commitments[scope]?.count||0):null,
   incomplete_commitments:commitments?(commitments[scope]?.incomplete||0):null,ask:asks?round(asks[scope]||0):null};
 });
 return {generated_at:new Date().toISOString(),group,ask_year:askYear,units:result,notes,
  definitions:{reserve:'Department-controlled "Department - general" expendable balance plus department-controlled GIB carried forward, at fiscal year-end.',
   resources:'Department-controlled GIB base plus Pool A endowment payout on department-controlled general accounts, for the same fiscal year.',
   months:'Published general balance plus GIB carryforward divided by one month of annual GIB base and general-fund payout. This comparison ratio does not establish uncommitted spending runway.',
   trend:'Change in reserve per year over the years shown, as a share of the latest year\'s annual resources.',
   gib_use_rate:'Share of the year\'s available GIB (base plus carry-in) that was used rather than carried forward.',
   excluded:'Restricted department funds (research, professorships, graduate support, other restricted, building) and faculty-controlled funds are shown separately and are not counted in the reserve.'}};
}

let cache=null;
export function createReservesHandler({authorize=access.authorize,load=loadReserves,now=()=>Date.now()}={}){return async event=>{
 const reply=(status,data)=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(event.httpMethod!=='GET')return reply(405,{error:'GET required.'});
 const auth=await authorize(event,{scope:'school',minimum:'admin'});if(auth.statusCode)return auth;
 if(auth.features?.wallets===false)return reply(403,{error:'Wallet data is currently hidden for this access level.'});
 const asked=event.queryStringParameters?.group,group=GROUPS.includes(asked)?asked:'academic';
 try{if(!cache||cache.group!==group||now()-cache.at>5*60*1000||event.queryStringParameters?.refresh==='1')cache={group,at:now(),data:await load({group})};return reply(200,cache.data);}
 catch(e){console.error('Reserves:',e.message);return reply(503,{error:'Reserve data is temporarily unavailable.'});}
};}
export const handler=createReservesHandler();
