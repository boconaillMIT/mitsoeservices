import {requestRevision,compareRequestPriority} from '../public/budget-priority.mjs';
import {reserveMetrics} from '../public/reserve-metrics.mjs';
import {consolidateHistoryRows} from './budget-history-groups.mjs';
// SoE HQ budget cycle: per-unit request lines (QuickBase budget table), draft decisions
// (decline / support at a % with an SoE vs Provost split), roll-ups and CSV export.
// Decisions, the Dean's briefing, documents-folder links and the change log are stored in
// QuickBase tables of their own (see budget-hq-qb.mjs); the site stores nothing. Decisions are
// NOT written to the budget table's historical "Approved" fields, which feed the Budget Explorer.
// Access: viewing needs school-wide read (full audience); changing decisions needs school-wide write.
import {latestSubmission} from '../public/budget-submission.mjs';
import access from './access.cjs';
import policy from './policy.cjs';
import units from './units.cjs';
import nameMapping from './unit-name-mapping.cjs';
import {loadBudgetRecords,safeValue} from './budget-explorer.mjs';
import {mapRecord,numberOrNull,sumRequestFunding,isFacultyHireSlot} from '../public/budget-model.mjs';
import {loadReserves} from './reserves.mjs';
import {createBudgetHqStore,SECTION_LABEL} from './budget-hq-qb.mjs';
import {authorizeBudget} from './budget-access.mjs';
import budgetScopes from './budget-scopes.cjs';

export const DECISIONS=['pending','decline','support'];
const BRIEFING_UNITS={'x-neet':'NEET','x-mites':'MITES',lgo:'LGO',sdm:'SDM',gel:'TLC / GEL'};
const MAX_NOTE=1000,MAX_AUDIT=500;
export function parseCycle(value){const m=/^fy(\d{2})$/i.exec(String(value||''));return m?{cycle:'fy'+m[1],year:2000+Number(m[1])}:null;}
const slug=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'unassigned';
export function unitKeyFor(department){const budgetAliases={'IDSS / TPP':'idss','IDSS/TPP':'idss','CTL/SCM':'ctl','TLC/GEL':'gel'};const scope=budgetAliases[department]||nameMapping.scopeFor(department);return scope?units.permissionScope(scope):'x-'+slug(department);}
export function unitInfo(key,departments=[]){
 const u=units.ALL_UNITS[key]||(key==='school'?units.WALLETS.school:null);if(u)return {key,label:u.label,name:u.name,academic:Object.hasOwn(units.UNITS,key),has_wallet:true};
 const name=BRIEFING_UNITS[key]||departments[0]||'Unassigned';return {key,label:name,name:BRIEFING_UNITS[key]?name:name+' (not mapped to a site unit)',academic:false,has_wallet:false};
}

// ---------- QuickBase request lines ----------
export async function loadAskRows(load=loadBudgetRecords){
 const {selected,raw}=await load();
 return raw.map(r=>{const row=Object.fromEntries(selected.map(f=>[f.label,f.label==='Workbook Source JSON'?String(r[String(f.id)]?.value||'').slice(0,50000):safeValue(r[String(f.id)]?.value)]));const m=mapRecord(row);
  return {...m,record_id:String(r['3']?.value??''),revised:String(row['Revised Request Description']??'').trim(),original:String(row['Original Request Description']??'').trim(),
   recurring:numberOrNull(row['Recurring (base) - DLC']),onetime:numberOrNull(row['Non-recurring (non-base) - DLC']),unit_key:unitKeyFor(m.unit)};}).filter(r=>!r.facultyHireSlot);
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
export function recentBudgetOutcomes(all,key,year){
 const sum=(rows,field)=>{const values=rows.map(r=>r[field]).filter(Number.isFinite);return values.length?r0(values.reduce((a,b)=>a+b,0)):null;};
 const funding=r=>{const values=['school','provost','scc','unresolved'].map(k=>r[k]).filter(Number.isFinite);return values.length?values.reduce((a,b)=>a+b,0):null;};
 return [year-2,year-1].map(year=>{
  const rows=consolidateHistoryRows(all.filter(r=>r.unit_key===key&&r.year===year&&!isFacultyHireSlot(r)),key,year),requested=sum(rows,'requested'),school=sum(rows,'school');
  const known=rows.map(funding).filter(Number.isFinite),approved=known.length?r0(known.reduce((a,b)=>a+b,0)):null;
  const finalDeclines=rows.filter(r=>!r.declinedIsInitial),declined=sum(finalDeclines,'declined');
  const complete=rows.length>0&&rows.every(r=>Number.isFinite(r.requested)&&(funding(r)!==null||(!r.declinedIsInitial&&Number.isFinite(r.declined)))&&(r.history_group||((funding(r)??0)+(r.declinedIsInitial?0:r.declined??0)>=r.requested)));
  const outcome=!rows.length?'No record':!complete?'Outcome incomplete':approved>=requested?'Fully funded':approved>0?'Partially funded':'Not funded';
  const requests=rows.map(r=>{
   const awarded=funding(r),rejected=r.declinedIsInitial?null:r.declined??null;
   const status=awarded>0?(Number.isFinite(r.requested)&&awarded>=r.requested?'Approved':'Partially approved'):rejected>0&&Number.isFinite(r.requested)&&rejected>=r.requested?'Rejected':r.decision==='Removed'?'Removed':r.decision==='Approved'?'Approved (initial)':rejected>0?'Partially rejected':'Not recorded';
   return {description:String(r.revised||r.original||r.request||'Request').replace(/\s+/g,' ').trim(),requested:r.requested??null,approved:awarded,declined:rejected,initial_declined:r.declinedIsInitial?r.declined??null:null,school:r.school??null,provost:r.provost??null,scc:r.scc??null,unresolved:r.unresolved??null,status,recorded_status:r.decision||'',record_id:r.record_id||null,...(r.history_group?{history_group:r.history_group}:{})};
  });
  return {year,lines:rows.length,requested,school,provost:sum(rows,'provost'),scc:sum(rows,'scc'),unresolved:sum(rows,'unresolved'),initial_declined:sum(rows.filter(r=>r.declinedIsInitial),'declined'),approved,declined,outcome,complete,requests,unpriced:rows.filter(r=>!Number.isFinite(r.requested)).length};
 });
}
export function applyDecision(ask,dec){
 const requested=ask.requested,d=dec||{decision:'pending'};
 if(d.decision!=='support')return {decision:d.decision,support_pct:d.decision==='decline'?0:null,soe_pct:null,provost_pct:null,supported:d.decision==='decline'?0:null,soe:d.decision==='decline'?0:null,provost:d.decision==='decline'?0:null,supported_recurring:null,supported_onetime:null,note:d.note||'',updated_by:d.updated_by||null,updated_at:d.updated_at||null};
 const f=d.support_pct/100,supported=requested===null?null:requested*f,soe=supported===null?null:supported*d.soe_pct/100;
 return {decision:'support',support_pct:d.support_pct,soe_pct:d.soe_pct,provost_pct:Math.round((100-d.soe_pct)*10)/10,supported:r0(supported),soe:r0(soe),provost:supported===null?null:r0(supported-soe),
  supported_recurring:ask.recurring===null?null:r0(ask.recurring*f),supported_onetime:ask.onetime===null?null:r0(ask.onetime*f),note:d.note||'',updated_by:d.updated_by||null,updated_at:d.updated_at||null};
}
export function rollUp(lines){
 const sum=k=>lines.reduce((s,l)=>s+(l[k]??0),0),count=d=>lines.filter(l=>l.decision===d).length;
 return {lines:lines.length,request_funding:sumRequestFunding(lines),unpriced:lines.filter(l=>l.requested===null).length,source_workbooks:[...new Set(lines.flatMap(l=>l.source?.sources?.map(s=>s.workbook)||[]))],source_documents:[...new Set(lines.flatMap(l=>l.source?.submissions?.map(s=>s.document)||[]))],requested:lines.length&&lines.every(l=>l.requested===null)?null:r0(sum('requested')),recurring:r0(sum('recurring')),onetime:r0(sum('onetime')),supported:r0(sum('supported')),soe:r0(sum('soe')),provost:r0(sum('provost')),
  declined_requested:r0(lines.filter(l=>l.decision==='decline').reduce((s,l)=>s+(l.requested??0),0)),pending:count('pending'),supported_count:count('support'),declined_count:count('decline')};
}
const lineOf=(a,decisions)=>({record_id:a.record_id,description:a.revised||a.original||a.request,original:a.original,revised:a.revised,category:a.category,source:a.source,priority:requestRevision(a,a.unit_key,a.year)?.priority??null,request_funding:a.requestFunding,recurring:a.recurring,onetime:a.onetime,requested:a.requested,qb_status:a.decision,...applyDecision(a,decisions?.[a.record_id]),version:decisions?.[a.record_id]?.version||null});

// ---------- reserves snapshot (anonymous peers) ----------
let reserveCache=new Map();
async function reserveSnapshot(key,{reserves=loadReserves,now=Date.now()}={}){
 const group=Object.hasOwn(units.UNITS,key)?'academic':'other';const hit=reserveCache.get(group);
 let data=hit&&now-hit.at<5*60*1000?hit.data:null;if(!data){data=await reserves({group});reserveCache.set(group,{at:now,data});}
 const me=data.units.find(u=>u.scope===key);if(!me)return null;
 const latest=y=>y.years[y.years.length-1],point=u=>{const y=latest(u);if(!y||!u.trend)return null;const metric=reserveMetrics(y,{unpaidSoeSupport:u.open_commitments});return {months:metric.months,balance:metric.balance,growth:u.trend.per_year_pct_of_resources};};
 return {group,definitions:data.definitions,unit:{...me,point:point(me)},peers:data.units.filter(u=>u.scope!==key).map(point).filter(p=>p&&p.months!==null)};
}

// ---------- Dean's briefing and documents folder ----------
export const NOTE_SECTIONS=SECTION_LABEL;
export const MAX_NOTE_TEXT=10000;
// Documents live in an MIT Google Shared Drive; the site only keeps the folder link.
export function validFolderUrl(v){if(v==='')return true;try{const u=new URL(v);return u.protocol==='https:'&&u.hostname==='drive.google.com'&&/^\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]{10,}\/?$/.test(u.pathname)&&!u.username&&!u.password&&v.length<=300;}catch{return false;}}

// ---------- handlers ----------
export function createBudgetHqDataHandler({authorize=access.authorize,asks=loadAskRows,store=createBudgetHqStore(),reserves=loadReserves,now=()=>new Date(),appOrigin=process.env.APP_ORIGIN}={}){return async event=>{
 const base={...access.noStore,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 const reply=(status,data,headers={})=>({statusCode:status,headers:{...base,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 const q=event.queryStringParameters||{},method=event.httpMethod,writing=method!=='GET';
 if(!['GET','PUT'].includes(method))return reply(405,{error:'Method not allowed.'});
 let body={};
 if(writing){
  const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!appOrigin||h.origin!==appOrigin||h['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
  if(typeof event.body!=='string'||event.body.length>40000)return reply(413,{error:'Request too large.'});
  try{body=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid JSON.'});}
 }
 const c=parseCycle(writing?body.cycle:q.cycle);if(!c)return reply(400,{error:'Unknown budget cycle.'});
 const auth=await authorizeBudget(event,{authorize,writing,unit:writing?body.unit:q.unit});if(auth.statusCode)return auth;
 const ready=store.configured(),canEdit=!auth.budgetRestricted&&ready&&(policy.CAPABILITIES[auth.role]||0)>=policy.CAPABILITIES.write;
 if(auth.budgetRestricted&&!q.unit){if(q.format)return reply(403,{error:'Choose an authorized department before downloading.'});return reply(200,{cycle:c.cycle,year:c.year,restricted:true,can_edit:false,units:auth.budgetUnits.map(key=>({...unitInfo(key,[budgetScopes.BUDGET_UNITS[key]]),has_wallet:false}))});}
 let all,rows;try{all=(await asks()).filter(r=>!isFacultyHireSlot(r));rows=all.filter(a=>a.year===c.year);}catch(e){console.error('Budget HQ asks:',e.message);return reply(503,{error:'Budget requests are temporarily unavailable from QuickBase.'});}
 const byUnit=new Map();for(const a of rows){if(!byUnit.has(a.unit_key))byUnit.set(a.unit_key,[]);byUnit.get(a.unit_key).push(a);}
 const knownUnit=k=>typeof k==='string'&&/^[a-z0-9-]{1,60}$/.test(k)&&(byUnit.has(k)||(c.cycle==='fy28'&&Object.hasOwn(BRIEFING_UNITS,k))||(Object.hasOwn(units.ALL_UNITS,k)&&k!=='soe-fake'));
 const conflict=what=>reply(409,{error:`Someone else changed this ${what}. Reload to see the latest before saving.`});
 try{
 if(writing){
  if(!ready)return reply(503,{error:'The QuickBase tables for HQ decisions are not set up yet.'});
  const unit=String(body.unit||''),action=body.action||'decision',version=body.version||null;
  if(!knownUnit(unit))return reply(404,{error:'Unknown unit.'});
  if(action==='decision'){
   const ask=(byUnit.get(unit)||[]).find(a=>a.record_id===String(body.record_id||''));
   if(!ask||!/^\d{1,12}$/.test(ask.record_id))return reply(404,{error:'That request line is not in this unit and cycle.'});
   if(body.decision==='support'&&ask.requested===null)return reply(400,{error:'This request has no verified amount. Record its amount in QuickBase before setting a support percentage.'});
   const v=validateDecision(body);if(v.error)return reply(400,{error:v.error});
   const r=await store.saveDecision(c.cycle,unit,ask.record_id,v.value,version,auth.kerberos,(ask.revised||ask.original||ask.request||'Line '+ask.record_id).slice(0,120));
   if(r.conflict)return conflict('line');console.log('Budget HQ decision:',auth.kerberos,c.cycle,unit,ask.record_id,v.value.decision);
   return reply(200,{line:lineOf(ask,{[ask.record_id]:r.decision})});
  }
  if(action==='notes'){
   const section=String(body.section||''),text=typeof body.text==='string'?body.text.replace(/\r\n/g,'\n'):null;
   if(!Object.hasOwn(NOTE_SECTIONS,section))return reply(400,{error:'Unknown briefing section.'});
   if(text===null||text.length>MAX_NOTE_TEXT)return reply(400,{error:'Briefing text must be 10,000 characters or fewer.'});
   const r=await store.saveBriefing(c.cycle,unit,section,text,version,auth.kerberos);if(r.conflict)return conflict('briefing section');
   return reply(200,{section:r.section});
  }
  if(action==='folder'){
   const url=typeof body.url==='string'?body.url.trim():null;
   if(url===null||!validFolderUrl(url))return reply(400,{error:'Paste the link to a Google Drive folder (https://drive.google.com/drive/folders/…).'});
   const r=await store.saveLink(c.cycle,unit,url,version,auth.kerberos);if(r.conflict)return conflict('folder link');
   return reply(200,{link:r.link});
  }
  return reply(400,{error:'Unsupported action.'});
 }
 if(q.unit){
  const key=String(q.unit),list=byUnit.get(key)||[];
  if(!knownUnit(key))return reply(404,{error:'Unknown unit.'});
  const info=unitInfo(key,[...new Set(list.map(a=>a.unit))]);
  const saved=ready?await store.unit(c.cycle,key):{decisions:{},sections:Object.fromEntries(Object.keys(NOTE_SECTIONS).map(k=>[k,{text:'',updated_by:null,updated_at:null,version:null}])),link:{url:'',version:null},log:[]};
  const lines=list.map(a=>lineOf(a,saved.decisions)).sort(compareRequestPriority);
  let history=[];try{const past=all.filter(a=>a.unit_key===key&&a.year&&a.year<c.year);const ys=[...new Set(past.map(a=>a.year))].sort();
   history=ys.map(y=>{const g=past.filter(a=>a.year===y),s=k=>g.reduce((t,a)=>t+(a[k]??0),0);return {year:y,requested:r0(s('requested')),provost:r0(s('provost')),school:r0(s('school')),scc:r0(s('scc')),sources:past.filter(a=>a.year===y).map(a=>({description:a.revised||a.original||a.request,source:a.source})).filter(a=>a.source?.sources?.length),unresolved:r0(s('unresolved')),declined:r0(s('declined')),approved:r0(s('provost')+s('school')+s('scc')+s('unresolved'))};});}catch{}
  let snapshot=null;if(info.has_wallet&&auth.features?.wallets!==false){try{snapshot=await reserveSnapshot(key,{reserves});}catch(e){console.error('Budget HQ reserves:',e.message);}}
  if(q.format==='csv'){
   const cell=v=>v===null||v===undefined?'':'"'+String(typeof v==='string'&&/^\s*[=+@-]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"';
   const columns=['Unit','Record ID','Description','Requested','Asked of Dean / SoE','Asked of Provost','Asked of SCC','Unassigned request','Decision','Supported','SoE amount','Provost amount','Note'];
   const csv=[columns,...lines.map(l=>[info.label,l.record_id,l.description,l.requested,l.request_funding?.dean,l.request_funding?.provost,l.request_funding?.scc,l.request_funding?.unassigned,l.decision,l.supported,l.soe,l.provost,l.note])].map(row=>row.map(cell).join(',')).join('\r\n');
   return {statusCode:200,headers:{...base,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${c.cycle.toUpperCase()}-${key}-budget.csv"`},body:csv};
  }
  return reply(200,{cycle:c.cycle,year:c.year,restricted:Boolean(auth.budgetRestricted),unit:info,lines,totals:rollUp(lines),history,recent_budget_outcomes:recentBudgetOutcomes(all,key,c.year),reserves:snapshot,storage_ready:ready,can_edit:canEdit,
   wallet_extract_allowed:Boolean(!auth.budgetRestricted&&auth.features?.wallets!==false&&info.has_wallet),submission:latestSubmission(list,key,c.year),notes:{sections:saved.sections},note_sections:NOTE_SECTIONS,folder:saved.link,log:saved.log,generated_at:now().toISOString()});
 }
 const decided=ready?await store.cycleDecisions(c.cycle):{};
 const keys=[...new Set([...Object.keys(units.UNITS).filter(k=>k!=='soe-fake'),...byUnit.keys(),...(c.cycle==='fy28'?Object.keys(BRIEFING_UNITS):[])])];
 const list=keys.map(k=>{const ls=(byUnit.get(k)||[]).map(a=>lineOf(a,decided[k]));return {...unitInfo(k,[...new Set((byUnit.get(k)||[]).map(a=>a.unit))]),...rollUp(ls)};})
  .sort((a,b)=>(b.academic-a.academic)||String(a.label).localeCompare(b.label));
 if(q.format==='csv'){
  const cols=['Unit','Record ID','Description','Category','Recurring requested','One-time requested','Requested','Asked of Dean / SoE','Asked of Provost','Asked of SCC','Unassigned request','Decision','Support %','Supported','SoE %','SoE amount','Provost %','Provost amount','Note','Updated by','Updated at'];
  const cell=v=>{if(v===null||v===undefined)return '';if(typeof v==='number')return String(v);let s=String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n\r]/.test(s)||s.startsWith("'")?'"'+s.replace(/"/g,'""')+'"':s;};
  const out=[cols.join(',')];for(const k of keys)for(const a of byUnit.get(k)||[]){const l=lineOf(a,decided[k]);out.push([unitInfo(k).label,l.record_id,l.description,l.category,l.recurring,l.onetime,l.requested,l.request_funding?.dean,l.request_funding?.provost,l.request_funding?.scc,l.request_funding?.unassigned,l.decision,l.support_pct,l.supported,l.soe_pct,l.soe,l.provost_pct,l.provost,l.note,l.updated_by,l.updated_at].map(cell).join(','));}
  return {statusCode:200,headers:{...base,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="SoE-${c.cycle.toUpperCase()}-budget-decisions.csv"`},body:out.join('\r\n')};
 }
 return reply(200,{cycle:c.cycle,year:c.year,units:list,totals:rollUp(keys.flatMap(k=>(byUnit.get(k)||[]).map(a=>lineOf(a,decided[k])))),storage_ready:ready,can_edit:canEdit,generated_at:now().toISOString()});
 }catch(e){console.error('Budget HQ:',e.message);return reply(503,{error:'Budget data is temporarily unavailable from QuickBase.'});}
};}
export const dataHandler=createBudgetHqDataHandler();
