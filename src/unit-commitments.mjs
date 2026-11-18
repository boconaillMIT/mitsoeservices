import access from './access.cjs';
import units from './units.cjs';
import {qbRequest} from './nimbus-store.mjs';
import nameMapping from './unit-name-mapping.cjs';
export const COMMITMENTS_TABLE='bs2metn5i',PAYMENTS_TABLE='bs2mgyyvx';
const normalize=v=>String(v??'').trim().replace(/\s+/g,' ').toLowerCase();
export const UNIT_ALIASES=nameMapping.aliases;
export const departmentScope=nameMapping.scopeFor;
export const fiscalYear=value=>{const m=/^(?:FY)?(\d{2}|\d{4})$/.exec(String(value??'').replace(/\s+/g,'').toUpperCase());if(!m)return null;const n=Number(m[1]),year=m[1].length===2?(n>=90?1900+n:2000+n):n;return year>=1990&&year<=2100?year:null;};
const v=(r,id)=>r[String(id)]?.value;
const text=(value,max=2000)=>String(value??'').slice(0,max);
function id(value){const n=Number(value);if(value===null||value===undefined||value===''||!Number.isSafeInteger(n)||n<=0)throw Error('Invalid record identity.');return String(n);}
function cents(raw){if(raw===null||raw===undefined||String(raw).trim()==='')return null;if(!['number','string'].includes(typeof raw)||!Number.isFinite(Number(raw))||Math.abs(Number(raw))>1e12)throw Error('Invalid payment amount.');return Math.round(Number(raw)*100);}
function amount(raw){try{const n=cents(raw);return n===null?null:n/100;}catch{return null;}}
function paymentAmount(record){let total=0,provided=false;try{for(const field of [12,35,34]){const n=cents(v(record,field));if(n!==null){provided=true;total+=n;}}return provided?total/100:null;}catch{return null;}}
function modified(record){const value=v(record,2);if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw Error('Source modification date is missing.');return value;}
const openWhere="({26.EX.'Active'}OR{26.EX.'Pending'})AND{31.EX.'Outgoing'}";
async function queryAll(query,table,select,where){const rows=[],seen=new Set();let expected=null;
 for(let page=0;page<10;page++){const result=await query('records/query',{from:table,select,where,sortBy:[{fieldId:3,order:'ASC'}],options:{skip:rows.length,top:1000}});
  if(!Array.isArray(result.data)||!Number.isInteger(result.metadata?.totalRecords)||result.metadata.totalRecords>10000||expected!==null&&expected!==result.metadata.totalRecords)throw Error('Incomplete source results.');expected=result.metadata.totalRecords;
  for(const record of result.data){const key=id(v(record,3));if(seen.has(key))throw Error('Duplicate source record.');seen.add(key);rows.push(record);}
  if(rows.length===expected)return rows;if(!result.data.length||rows.length>expected)throw Error('Source changed during pagination.');
 }throw Error('Source result limit exceeded.');
}
export async function loadCommitments(query,scope){
 if(scope==='soe-fake'||scope!=='all'&&!UNIT_ALIASES[scope])return {commitments:[],payments:[]};
 const metadataFields=[3,2,12,26,31],select=[3,2,12,14,42,13,26,31,6,16,11];let raw=[];
 if(scope==='all')raw=await queryAll(query,COMMITMENTS_TABLE,select,openWhere);
 else{
  // Match only routing metadata first. Fetch financial fields by validated IDs,
  // so spacing/punctuation variants cannot be missed by literal DB comparisons.
  const metadata=await queryAll(query,COMMITMENTS_TABLE,metadataFields,openWhere);
  const own=metadata.filter(r=>departmentScope(v(r,12))===scope),keys=own.map(r=>id(v(r,3)));
  for(let i=0;i<keys.length;i+=40){const where=openWhere+'AND('+keys.slice(i,i+40).map(key=>`{3.EX.'${key}'}`).join('OR')+')';raw.push(...await queryAll(query,COMMITMENTS_TABLE,select,where));}
  const expected=new Map(own.map(r=>[id(v(r,3)),modified(r)]));if(raw.length!==own.length||raw.some(r=>expected.get(id(v(r,3)))!==modified(r)))throw Error('Unit routing changed during the review.');
 }
 const parents=new Map(),commitments=raw.map(r=>{const key=id(v(r,3)),department=text(v(r,12),200),mapped=departmentScope(department),status=v(r,26);
  if(!['Active','Pending'].includes(status)||v(r,31)!=='Outgoing'||scope!=='all'&&mapped!==scope)throw Error('Commitment scope mismatch.');
  const result={id:key,unit:mapped,unit_name:mapped?units.WALLETS[mapped]?.label:null,department,title:text(v(r,14)),category:text(v(r,42)||v(r,13),300),status,type:text(v(r,16),120),start_year:fiscalYear(v(r,6)),recorded_amount:amount(v(r,11)),updated_at:modified(r)};parents.set(key,result);return result;
 });
 const payments=[],ids=[...parents.keys()];
 for(let i=0;i<ids.length;i+=40){const list=ids.slice(i,i+40),where='('+list.map(key=>`{42.EX.'${key}'}`).join('OR')+")AND({24.EX.'Projected'}OR{24.EX.'Actual'})";
  const rawPayments=await queryAll(query,PAYMENTS_TABLE,[3,2,42,45,25,24,11,12,35,34,13,14],where);
  for(const r of rawPayments){const parent=parents.get(id(v(r,42))),status=v(r,24);if(!parent||!list.includes(parent.id)||!['Projected','Actual'].includes(status))throw Error('Payment scope mismatch.');
   const department=v(r,45);if(department!==null&&department!==undefined&&department!==''&&(parent.unit?departmentScope(department)!==parent.unit:normalize(department)!==normalize(parent.department)))throw Error('Payment department changed.');
   payments.push({id:id(v(r,3)),commitment_id:parent.id,year:fiscalYear(v(r,25)),date:typeof v(r,11)==='string'&&Number.isFinite(Date.parse(v(r,11)))?v(r,11):null,status,type:text(v(r,13),160),amount:paymentAmount(r),reference:text(v(r,14),200),updated_at:modified(r)});
  }
 }
 if(new Set(payments.map(p=>p.id)).size!==payments.length)throw Error('Duplicate payment results.');
 // Recheck scope and version after reading payments; never publish a mixed revision.
 if(raw.length||scope!=='all'){const latestAll=await queryAll(query,COMMITMENTS_TABLE,metadataFields,openWhere),latest=scope==='all'?latestAll:latestAll.filter(r=>departmentScope(v(r,12))===scope);if(latest.length!==raw.length||latest.some(r=>{const old=parents.get(id(v(r,3)));return !old||modified(r)!==old.updated_at||normalize(v(r,12))!==normalize(old.department)||v(r,26)!==old.status||v(r,31)!=='Outgoing';}))throw Error('Commitments changed during the review.');}
 return {commitments,payments};
}
export function unpaidClassification(commitment,payments){const actual=payments.filter(p=>p.commitment_id===commitment.id&&p.status==='Actual'),missing=commitment.recorded_amount===null||commitment.recorded_amount<=0||actual.some(p=>p.amount===null),paid=actual.some(p=>p.amount===null)?null:actual.reduce((n,p)=>n+Math.round(p.amount*100),0)/100,unpaid=missing||paid===null?null:(Math.round(commitment.recorded_amount*100)-Math.round(paid*100))/100;return {...commitment,actual_all_years:paid,unpaid,missing_info:missing,archived:!missing&&unpaid<=0,archive_reason:!missing&&unpaid<=0?'Paid in full':'',source_url:'https://mit.quickbase.com/nav/app/br2xvzd7a/table/bs2metn5i/action/dr?rid='+commitment.id};}
export async function loadHistoricalClosed(query,scope){if(scope==='soe-fake')return [];const where="{31.EX.'Outgoing'}",select=[3,2,12,26,31],meta=await queryAll(query,COMMITMENTS_TABLE,select,where),isClosed=r=>/^(closed|declined)/i.test(String(v(r,26)||'')),own=meta.filter(r=>isClosed(r)&&(scope==='all'||departmentScope(v(r,12))===scope)),expected=new Map(own.map(r=>[id(v(r,3)),modified(r)])),result=[];
 for(let i=0;i<own.length;i+=40){const keys=own.slice(i,i+40).map(r=>id(v(r,3))),rows=await queryAll(query,COMMITMENTS_TABLE,[3,2,12,14,42,13,26,31,6,16,11],where+'AND('+keys.map(k=>`{3.EX.'${k}'}`).join('OR')+')');for(const r of rows){const key=id(v(r,3)),mapped=departmentScope(v(r,12));if(!isClosed(r)||v(r,31)!=='Outgoing'||scope!=='all'&&mapped!==scope||expected.get(key)!==modified(r))throw Error('Closed commitment scope changed.');result.push({id:key,unit:mapped,unit_name:mapped?units.WALLETS[mapped]?.label:null,department:text(v(r,12),200),title:text(v(r,14)),category:text(v(r,42)||v(r,13),300),type:text(v(r,16),120),start_year:fiscalYear(v(r,6)),recorded_amount:amount(v(r,11)),status:text(v(r,26)),updated_at:modified(r),unpaid:null,actual_all_years:null,missing_info:false,archived:true,archive_reason:'Closed in source',source_url:'https://mit.quickbase.com/nav/app/br2xvzd7a/table/bs2metn5i/action/dr?rid='+key});}}
 if(result.length!==own.length)throw Error('Incomplete closed commitments.');const latest=(await queryAll(query,COMMITMENTS_TABLE,select,where)).filter(r=>isClosed(r)&&(scope==='all'||departmentScope(v(r,12))===scope));if(latest.length!==own.length||latest.some(r=>expected.get(id(v(r,3)))!==modified(r)))throw Error('Closed commitments changed during review.');return result;
}
export function createUnitCommitmentsHandler({authorize=access.authorize,query=qbRequest,now=()=>new Date()}={}){return async event=>{
 const reply=(status,body)=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(event.httpMethod!=='GET')return reply(405,{error:'Read-only report; GET required.'});
 const unit=event.queryStringParameters?.unit||'',all=unit==='all';if(!all&&!Object.hasOwn({...units.ALL_UNITS,school:units.WALLETS.school},unit))return reply(404,{error:'Unit not found.'});
 const auth=await authorize(event,{scope:all?'school':unit,minimum:all?'admin':'read',audience:'full'});if(!auth.user)return auth;
 const year=Number(event.queryStringParameters?.year||2027),view=event.queryStringParameters?.view||'open';if(!Number.isInteger(year)||year<2000||year>2100||!['open','closed'].includes(view))return reply(400,{error:'Choose a valid fiscal year and view.'});
 try{const data=await loadCommitments(query,unit),classified=data.commitments.map(c=>unpaidClassification(c,data.payments)),historical=view==='closed'?await loadHistoricalClosed(query,unit):[],commitments=view==='closed'?[...classified.filter(c=>c.archived),...historical]:classified.filter(c=>!c.archived),keys=new Set(commitments.map(c=>c.id)),years=[...new Set([2026,2027,2028,...data.payments.map(p=>p.year).filter(y=>y>=2000&&y<=2100)])].sort((a,b)=>b-a),payments=data.payments.filter(p=>p.year===year&&keys.has(p.commitment_id)),dates=[...commitments,...payments].map(r=>r.updated_at).sort((a,b)=>Date.parse(b)-Date.parse(a));
  return reply(200,{unit,year,years,view,checked_at:now().toISOString(),source_updated_at:dates[0]||null,commitments,payments,historical_payments_not_loaded:historical.length,invalid_year_payments:data.payments.filter(p=>p.year===null).length,unassigned_commitments:all?commitments.filter(c=>!c.unit).length:null});
 }catch{return reply(503,{error:'Commitments and payments could not be verified for this unit. No other unit data was substituted. Please retry or contact a SoE administrator.'});}
};}
export const handler=createUnitCommitmentsHandler();
