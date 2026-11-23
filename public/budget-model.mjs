import {submissionLineHtml} from './budget-submission.mjs';
const fieldNames={year:'Budget Fiscal Year',unit:'Department',original:'Original Request Description',revised:'Revised Request Description',category:'Request Nimbus category',request:'Request Amount',requestBase:'Recurring (base) - DLC',requestNon:'Non-recurring (non-base) - DLC',provostBase:'Provost Recurring (base) - Approved',provostNon:'Provost Non-recurring (non-base) - Approved',school:'SoE Non-recurring (non-base) - SoE_Approved',scc:'SCC Non-recurring (non-base) - Approved',declined:'Declined',declinedFinal:'Declined Final',unresolved:'Historical allocation - funder unresolved',decision:'Status of Initial Request'};
export const academicUnits=new Set(['aero-astro','be','cheme','cee','dmse','eecs','imes','meche','nse']);
export const otherUnits=new Set(['cce','ctl/scm','gel','lgo','mites','neet','ppsm','scm','sdm','soe','upop','ihq']);
export function numberOrNull(value){if(value===null||value===undefined||value==='')return null;if(typeof value==='number')return Number.isFinite(value)?value:null;const text=String(value).trim();if(!text)return null;const neg=/^\(.*\)$/.test(text),n=Number(text.replace(/[$,()\s]/g,''));return Number.isFinite(n)?(neg?-n:n):null;}
function sumPresent(...values){const present=values.filter(v=>v!==null);return present.length?present.reduce((a,b)=>a+b,0):null;}
export function mapRecord(row){
 const get=key=>row[fieldNames[key]],base=numberOrNull(get('requestBase')),non=numberOrNull(get('requestNon')),request=numberOrNull(get('request'));
 const finalDeclined=numberOrNull(get('declinedFinal')),initialDeclined=numberOrNull(get('declined'));
 const rawYear=String(get('year')??'').trim(),match=/^(?:FY\s*)?(\d{2}|\d{4})$/i.exec(rawYear),year=match?(match[1].length===2?2000+Number(match[1]):Number(match[1])):null;
 const provostBase=numberOrNull(get('provostBase')),provostNon=numberOrNull(get('provostNon'));
 const requested=sumPresent(base,non)??request;
 return {year,unit:String(get('unit')??'').trim(),request:String(get('original')||get('revised')||'').trim(),category:String(get('category')??'').trim(),requested,requestFunding:requestFunding(row,requested),provost:sumPresent(provostBase,provostNon),provostBase,provostNon,school:numberOrNull(get('school')),scc:numberOrNull(get('scc')),declined:finalDeclined??initialDeclined,declinedIsInitial:finalDeclined===null&&initialDeclined!==null,unresolved:numberOrNull(get('unresolved')),decision:String(get('decision')??'').trim(),source:parseWorkbookSource(row['Workbook Source JSON'])};
}
// Request-side funding offices are independent of approved funding and HQ decisions.
export function requestFunding(row,total){
 const dean=numberOrNull(row['SoE Non-recurring (non-base) - SoE']),provost=sumPresent(numberOrNull(row['Provost Recurring (base) - SoE']),numberOrNull(row['Provost Non-recurring (non-base) - SoE'])),scc=numberOrNull(row['SCC Non-recurring (non-base) - SoE request']);
 const parts=[dean,provost,scc],assigned=sumPresent(...parts),unassigned=total===null?null:Math.round((total-(assigned??0))*100)/100;
 return {dean,provost,scc,assigned,total,unassigned};
}
export function sumRequestFunding(lines){
 const items=lines.map(l=>l.request_funding||{total:l.requested??null,dean:null,provost:null,scc:null,assigned:null,unassigned:l.requested??null}),sum=k=>{const xs=items.map(i=>i[k]).filter(v=>typeof v==='number'&&Number.isFinite(v));return xs.length?Math.round(xs.reduce((a,b)=>a+b,0)*100)/100:null;};
 return {dean:sum('dean'),provost:sum('provost'),scc:sum('scc'),assigned:sum('assigned'),total:sum('total'),unassigned:sum('unassigned'),incomplete:items.filter(i=>i.unassigned===null||Math.abs(i.unassigned)>.005).length};
}
export function totals(rows){return Object.fromEntries(['requested','provost','provostBase','provostNon','school','scc','declined','unresolved'].map(key=>{const present=rows.map(row=>row[key]).filter(v=>typeof v==='number'&&Number.isFinite(v));return [key,{amount:present.length?present.reduce((a,b)=>a+b,0):null,recorded:present.length,total:rows.length}];}));}
export function groupForUnit(unit){const key=String(unit).trim().toLowerCase();return academicUnits.has(key)?'Academic units':otherUnits.has(key)?'Other units':'Combined or unclassified';}
export function parseWorkbookSource(value){try{if(typeof value!=='string'||value.length>50000)return null;const data=JSON.parse(value);return data.schema===1&&Array.isArray(data.sources)&&data.sources.length<=40&&data.sources.every(s=>s&&typeof s==='object'&&typeof s.workbook==='string'&&typeof s.sheet==='string'&&Number.isInteger(s.row))?data:null;}catch{return null;}}
export function workbookSourceHtml(source){
 if(!source?.sources?.length)return '';const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money=v=>typeof v==='number'&&Number.isFinite(v)?'$'+v.toLocaleString('en-US',{maximumFractionDigits:2}):'not specified';
 return `<details class="budget-source-note"><summary>Workbook context${source.sources.length>1?' ('+source.sources.length+')':''}</summary>${source.sources.map(s=>`<div><p><strong>${esc(s.workbook)}</strong><br>${esc(s.sheet)} · row ${esc(s.row)}</p><p>${esc(s.description)}</p>${s.notes?`<p>${esc(s.notes)}</p>`:''}${Array.isArray(s.issues)&&s.issues.length?`<ul>${s.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:''}${s.proposed?`<p>Working allocation, subject to review: Provost ${money(s.proposed.provostBase===null&&s.proposed.provostNon===null?null:(s.proposed.provostBase??0)+(s.proposed.provostNon??0))}; SoE ${money(s.proposed.school)}; SCC ${money(s.proposed.scc)}. Workbook reject column: ${money(s.proposed.reject)}. These are not HQ decisions or approved funding.</p>`:''}${s.reconciliation?`<p>${esc(s.reconciliation)}</p>`:''}</div>`).join('')}</details>`+submissionLineHtml(source);
}
