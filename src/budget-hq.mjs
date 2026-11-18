// SoE HQ budget cycle: per-unit request lines (QuickBase budget table), draft decisions
// (decline / support at a % with an SoE vs Provost split), roll-ups and CSV export.
// Decisions are HQ working records: stored encrypted in Netlify Blobs (one document per
// cycle+unit, optimistic concurrency, change history). They are NOT written to QuickBase's
// historical "Approved" fields, which feed the Budget Explorer.
// Access: viewing needs school-wide read (full audience); changing decisions needs school-wide write.
import {hkdfSync} from 'node:crypto';
import access from './access.cjs';
import policy from './policy.cjs';
import units from './units.cjs';
import nameMapping from './unit-name-mapping.cjs';
import {loadBudgetRecords,safeValue} from './budget-explorer.mjs';
import {mapRecord,numberOrNull} from '../public/budget-model.mjs';
import {loadReserves} from './reserves.mjs';
import {seal,unseal} from './nimbus-store.mjs';

export const DECISIONS=['pending','decline','support'];
const MAX_NOTE=1000,MAX_AUDIT=500;
export function parseCycle(value){const m=/^fy(\d{2})$/i.exec(String(value||''));return m?{cycle:'fy'+m[1],year:2000+Number(m[1])}:null;}
const slug=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'unassigned';
export function unitKeyFor(department){const scope=nameMapping.scopeFor(department);return scope?units.permissionScope(scope):'x-'+slug(department);}
export function unitInfo(key,departments=[]){
 const u=units.ALL_UNITS[key];if(u)return {key,label:u.label,name:u.name,academic:Object.hasOwn(units.UNITS,key),has_wallet:true};
 const name=departments[0]||'Unassigned';return {key,label:name,name:name+' (not mapped to a site unit)',academic:false,has_wallet:false};
}

// ---------- QuickBase request lines ----------
export async function loadAskRows(load=loadBudgetRecords){
 const {selected,raw}=await load();
 return raw.map(r=>{const row=Object.fromEntries(selected.map(f=>[f.label,safeValue(r[String(f.id)]?.value)]));const m=mapRecord(row);
  return {...m,record_id:String(r['3']?.value??''),revised:String(row['Revised Request Description']??'').trim(),original:String(row['Original Request Description']??'').trim(),
   recurring:numberOrNull(row['Recurring (base) - DLC']),onetime:numberOrNull(row['Non-recurring (non-base) - DLC']),unit_key:unitKeyFor(m.unit)};});
}

// ---------- decision store ----------
function storeKey(){if(!process.env.UNIT_FILES_DATA_KEY||process.env.UNIT_FILES_DATA_KEY.length<32)throw Error('Budget decision encryption is not configured.');return Buffer.from(hkdfSync('sha256',process.env.UNIT_FILES_DATA_KEY,'MITSOEServices budget HQ '+policy.deploymentName(),'budget-hq-v1',32));}
const binding=(cycle,unit)=>'budget-hq-v1:'+policy.deploymentName()+':'+cycle+':'+unit;
export async function decisionStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'mitsoeservices-budget-hq-'+policy.deploymentName(),consistency:'strong'});}
const emptyDoc=(cycle,unit)=>({schema:1,cycle,unit,decisions:{},audit:[]});
export function createDecisionRepository({store=decisionStore,key=storeKey}={}){
 const open=async()=>typeof store==='function'?store():store;
 return {
  async read(cycle,unit){const s=await open(),e=await s.getWithMetadata(cycle+'/'+unit,{type:'text'});if(!e)return {doc:emptyDoc(cycle,unit),etag:null};
   const doc=unseal(e.data,key(),binding(cycle,unit));if(doc.cycle!==cycle||doc.unit!==unit)throw Error('Decision record binding mismatch.');return {doc,etag:e.etag};},
  async readAll(cycle){const s=await open(),{blobs}=await s.list({prefix:cycle+'/'});const out={};
   await Promise.all(blobs.map(async b=>{const unit=b.key.slice(cycle.length+1);out[unit]=(await this.read(cycle,unit)).doc;}));return out;},
  async write(cycle,unit,doc,etag){const s=await open(),body=seal(doc,key(),binding(cycle,unit));
   const r=await s.set(cycle+'/'+unit,body,etag?{onlyIfMatch:etag}:{onlyIfNew:true});if(r?.modified===false)return {conflict:true};return {etag:r?.etag??null};}
 };
}

export function validateDecision(input){
 const d=input?.decision;if(!DECISIONS.includes(d))return {error:'Choose pending, decline or support.'};
 const note=input.note===undefined||input.note===null?'':String(input.note);if(note.length>MAX_NOTE)return {error:'Note is too long (1,000 characters).'};
 if(d!=='support')return {value:{decision:d,support_pct:null,soe_pct:null,note}};
 const num=(v,name)=>{const n=typeof v==='number'?v:Number(v);return Number.isFinite(n)&&n>=0&&n<=100&&Math.round(n*10)===n*10?n:Error(name);};
 const sp=num(input.support_pct,'support'),soe=num(input.soe_pct,'soe');
 if(sp instanceof Error||sp===0)return {error:'Support level must be between 0.1% and 100%.'};
 if(soe instanceof Error)return {error:'SoE share must be between 0% and 100%.'};
 return {value:{decision:d,support_pct:sp,soe_pct:soe,note}};
}
const r0=v=>v===null||!Number.isFinite(v)?null:Math.round(v);
export function applyDecision(ask,dec){
 const requested=ask.requested??0,d=dec||{decision:'pending'};
 if(d.decision!=='support')return {decision:d.decision,support_pct:d.decision==='decline'?0:null,soe_pct:null,provost_pct:null,supported:d.decision==='decline'?0:null,soe:d.decision==='decline'?0:null,provost:d.decision==='decline'?0:null,supported_recurring:null,supported_onetime:null,note:d.note||'',updated_by:d.updated_by||null,updated_at:d.updated_at||null};
 const f=d.support_pct/100,supported=requested*f,soe=supported*d.soe_pct/100;
 return {decision:'support',support_pct:d.support_pct,soe_pct:d.soe_pct,provost_pct:Math.round((100-d.soe_pct)*10)/10,supported:r0(supported),soe:r0(soe),provost:r0(supported-soe),
  supported_recurring:ask.recurring===null?null:r0(ask.recurring*f),supported_onetime:ask.onetime===null?null:r0(ask.onetime*f),note:d.note||'',updated_by:d.updated_by||null,updated_at:d.updated_at||null};
}
export function rollUp(lines){
 const sum=k=>lines.reduce((s,l)=>s+(l[k]??0),0),count=d=>lines.filter(l=>l.decision===d).length;
 return {lines:lines.length,requested:r0(sum('requested')),recurring:r0(sum('recurring')),onetime:r0(sum('onetime')),supported:r0(sum('supported')),soe:r0(sum('soe')),provost:r0(sum('provost')),
  declined_requested:r0(lines.filter(l=>l.decision==='decline').reduce((s,l)=>s+(l.requested??0),0)),pending:count('pending'),supported_count:count('support'),declined_count:count('decline')};
}
const lineOf=(a,doc)=>({record_id:a.record_id,description:a.revised||a.original||a.request,original:a.original,revised:a.revised,category:a.category,recurring:a.recurring,onetime:a.onetime,requested:a.requested,qb_status:a.decision,...applyDecision(a,doc?.decisions?.[a.record_id])});

// ---------- reserves snapshot (anonymous peers) ----------
let reserveCache=new Map();
async function reserveSnapshot(key,{reserves=loadReserves,now=Date.now()}={}){
 const group=Object.hasOwn(units.UNITS,key)?'academic':'other';const hit=reserveCache.get(group);
 let data=hit&&now-hit.at<5*60*1000?hit.data:null;if(!data){data=await reserves({group});reserveCache.set(group,{at:now,data});}
 const me=data.units.find(u=>u.scope===key);if(!me)return null;
 const latest=y=>y.years[y.years.length-1],point=u=>{const y=latest(u);if(!y||!u.trend)return null;const free=y.reserve-(u.open_commitments||0);return {months:y.resources>0?Math.round(free/(y.resources/12)*10)/10:null,growth:u.trend.per_year_pct_of_resources};};
 return {group,definitions:data.definitions,unit:{...me,point:point(me)},peers:data.units.filter(u=>u.scope!==key).map(point).filter(p=>p&&p.months!==null)};
}

// ---------- handlers ----------
export function createBudgetHqDataHandler({authorize=access.authorize,asks=loadAskRows,repo=createDecisionRepository(),reserves=loadReserves,now=()=>new Date()}={}){return async event=>{
 const reply=(status,data,headers={})=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 const q=event.queryStringParameters||{},method=event.httpMethod;
 if(!['GET','PUT'].includes(method))return reply(405,{error:'Method not allowed.'});
 let body={};if(method==='PUT'){try{body=JSON.parse(event.body||'{}');}catch{return reply(400,{error:'Invalid JSON.'});}}
 const c=parseCycle(method==='PUT'?body.cycle:q.cycle);if(!c)return reply(400,{error:'Unknown budget cycle.'});
 const auth=await authorize(event,{scope:'school',minimum:method==='PUT'?'write':'read'});if(auth.statusCode)return auth;
 const canEdit=(policy.CAPABILITIES[auth.role]||0)>=policy.CAPABILITIES.write;
 let all,rows;try{all=await asks();rows=all.filter(a=>a.year===c.year);}catch(e){console.error('Budget HQ asks:',e.message);return reply(503,{error:'Budget requests are temporarily unavailable from QuickBase.'});}
 const byUnit=new Map();for(const a of rows){if(!byUnit.has(a.unit_key))byUnit.set(a.unit_key,[]);byUnit.get(a.unit_key).push(a);}
 try{
 if(method==='PUT'){
  const unit=String(body.unit||''),list=byUnit.get(unit)||[],ask=list.find(a=>a.record_id===String(body.record_id||''));
  if(!ask)return reply(404,{error:'That request line is not in this unit and cycle.'});
  const v=validateDecision(body);if(v.error)return reply(400,{error:v.error});
  const {doc,etag}=await repo.read(c.cycle,unit);if((body.etag||null)!==(etag||null))return reply(409,{error:'Someone else changed this unit’s decisions. Reload to see the latest.',etag});
  const at=now().toISOString(),prev=doc.decisions[ask.record_id]||null,next={...v.value,updated_by:auth.kerberos,updated_at:at};
  const decisions={...doc.decisions};if(next.decision==='pending'&&!next.note)delete decisions[ask.record_id];else decisions[ask.record_id]=next;
  const audit=[...doc.audit,{at,by:auth.kerberos,record_id:ask.record_id,from:prev?{decision:prev.decision,support_pct:prev.support_pct,soe_pct:prev.soe_pct}:null,to:{decision:next.decision,support_pct:next.support_pct,soe_pct:next.soe_pct},note_changed:(prev?.note||'')!==next.note}].slice(-MAX_AUDIT);
  const saved=await repo.write(c.cycle,unit,{...doc,decisions,audit},etag);if(saved.conflict)return reply(409,{error:'Someone else changed this unit’s decisions. Reload to see the latest.'});
  console.log('Budget HQ decision:',auth.kerberos,c.cycle,unit,ask.record_id,next.decision,next.support_pct,next.soe_pct);
  return reply(200,{etag:saved.etag,line:lineOf(ask,{decisions})});
 }
 if(q.unit){
  const key=String(q.unit),list=byUnit.get(key)||[];
  if(!list.length&&!units.ALL_UNITS[key])return reply(404,{error:'Unknown unit.'});
  const info=unitInfo(key,[...new Set(list.map(a=>a.unit))]);const {doc,etag}=await repo.read(c.cycle,key);
  const lines=list.map(a=>lineOf(a,doc)).sort((a,b)=>(b.requested??0)-(a.requested??0));
  let history=[];try{const past=all.filter(a=>a.unit_key===key&&a.year&&a.year<c.year);const ys=[...new Set(past.map(a=>a.year))].sort();
   history=ys.map(y=>{const g=past.filter(a=>a.year===y),s=k=>g.reduce((t,a)=>t+(a[k]??0),0);return {year:y,requested:r0(s('requested')),provost:r0(s('provost')),school:r0(s('school')),unresolved:r0(s('unresolved')),declined:r0(s('declined')),approved:r0(s('provost')+s('school')+s('unresolved'))};});}catch{}
  let snapshot=null;if(info.has_wallet&&auth.features?.wallets!==false){try{snapshot=await reserveSnapshot(key,{reserves});}catch(e){console.error('Budget HQ reserves:',e.message);}}
  return reply(200,{cycle:c.cycle,year:c.year,unit:info,lines,totals:rollUp(lines),history,reserves:snapshot,etag,can_edit:canEdit,audit:doc.audit.slice(-25).reverse(),generated_at:now().toISOString()});
 }
 const docs=await repo.readAll(c.cycle);
 const keys=[...new Set([...Object.keys(units.UNITS).filter(k=>k!=='soe-fake'),...byUnit.keys()])];
 const list=keys.map(k=>{const ls=(byUnit.get(k)||[]).map(a=>lineOf(a,docs[k]));return {...unitInfo(k,[...new Set((byUnit.get(k)||[]).map(a=>a.unit))]),...rollUp(ls)};})
  .sort((a,b)=>(b.academic-a.academic)||String(a.label).localeCompare(b.label));
 if(q.format==='csv'){
  const cols=['Unit','Record ID','Description','Category','Recurring requested','One-time requested','Requested','Decision','Support %','Supported','SoE %','SoE amount','Provost %','Provost amount','Note','Updated by','Updated at'];
  const cell=v=>{if(v===null||v===undefined)return '';if(typeof v==='number')return String(v);let s=String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n\r]/.test(s)||s.startsWith("'")?'"'+s.replace(/"/g,'""')+'"':s;};
  const out=[cols.join(',')];for(const k of keys)for(const a of byUnit.get(k)||[]){const l=lineOf(a,docs[k]);out.push([unitInfo(k).label,l.record_id,l.description,l.category,l.recurring,l.onetime,l.requested,l.decision,l.support_pct,l.supported,l.soe_pct,l.soe,l.provost_pct,l.provost,l.note,l.updated_by,l.updated_at].map(cell).join(','));}
  return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="SoE-${c.cycle.toUpperCase()}-budget-decisions.csv"`},body:out.join('\r\n')};
 }
 return reply(200,{cycle:c.cycle,year:c.year,units:list,totals:rollUp(keys.flatMap(k=>(byUnit.get(k)||[]).map(a=>lineOf(a,docs[k])))),can_edit:canEdit,generated_at:now().toISOString()});
 }catch(e){console.error('Budget HQ:',e.message);return reply(503,{error:'Budget decisions are temporarily unavailable.'});}
};}
export const dataHandler=createBudgetHqDataHandler();
