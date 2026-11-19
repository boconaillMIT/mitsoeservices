// Workbook formats only. Financial values are loaded from private QuickBase snapshots.
const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
import {unitKey} from '../public/budget-source-math.mjs';
export {unitKey,MEASURES,sourceTotals,sourceGroups,compareBudgetSource} from '../public/budget-source-math.mjs';
const amount=c=>{if(!c||c.value===''||c.value===null||c.type==='e')return null;const n=Number(String(c.value).replace(/[$,]/g,''));return Number.isFinite(n)?n:null;};
const sum=values=>{const xs=values.filter(v=>v!==null&&Number.isFinite(v));return xs.length?xs.reduce((a,b)=>a+b,0):null;};
const cells=row=>Object.fromEntries(row.cells.map(c=>[c.cell.replace(/\d+$/,''),c]));
const colNumber=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
function totalIncludes(cell,column,row){if(!cell?.formula||!column)return false;const f=cell.formula.toUpperCase(),ref=new RegExp('(?:^|[^A-Z])\\$?'+column+'\\$?'+row+'(?:[^0-9]|$)');if(ref.test(f))return true;for(const match of f.matchAll(/\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/g))if(Number(match[2])===row&&Number(match[4])===row&&colNumber(column)>=colNumber(match[1])&&colNumber(column)<=colNumber(match[3]))return true;return false;}
const badLabel=s=>/^(?:sub\s*totals?|grand\s*total|totals?|dept\.?|department|request|source|approved|proposed|base|non-base|fy\d{2,4})\b/i.test(norm(s));
const maps=(unit,description,base,non,school,scc,declined,total,notes=[])=>({unit,description,base,non,school,scc,declined,total,notes});
function profiles(w){const out=[];const add=(sheet,id,year,label,kind,map,extra={})=>{if(w.sheets.some(s=>s.name.trim()===sheet))out.push({sheet,id,year,label,kind,map,...extra});};
 if(w.sourceId==='fy28-working'){
  for(const year of [2028,2027]){const sheet=`FY${String(year).slice(-2)} Working Document`;
   add(sheet,`${year}-initial`,year,'Initial request allocations','working',maps('B','C',['D'],['E'],'F','G','H','I',['J']));
   add(sheet,`${year}-post`,year,'Post-Provost meeting version','working',maps('L','M',['N'],['O'],'P','Q','R','S',['T']));
   add(sheet,`${year}-present`,year,'Presentation to Provost','working',maps('U','V',['W','X'],['Y'],'Z','AA','AB','AC',['AD','AE']));
   add(sheet,`${year}-final`,year,year===2028?'Final decisions (working template)':'Final decisions recorded in workbook',year===2028?'working':'final',maps('AG','AH',['AI'],['AJ'],'AK','AL','AM','AN',['AO','AP','AQ']));
  }
  const s='LAST YEAR FY26 Working Document';
  add(s,'2026-final',2026,'Final FY26 decisions recorded in workbook','final',maps('B','C',['D','E'],['F'],'G','H','I','J',['K']));
  add(s,'2026-initial',2026,'FY26 initial request allocations','working',maps('Y','Z',['AA'],['AB'],'AC','AD','AE','AF',['AG']));
  add(s,'2025-prior',2025,'Prior FY25 decisions shown on FY26 sheet','final',maps('M','N',['O'],['P'],'Q','R','S','T',['V']));
  add('FY25_Final Provost Decision','2025-final',2025,'Final Provost decisions','final',maps('A','B',['C'],['D'],'E','F','G','H',['I','J']));
  add('FY25_All of SoE','2024-final',2024,'Final FY24 decisions carried forward','final',maps('A','B',['C'],['D'],'E','F','G','H',['I']));
  add('FY25_All of SoE','2025-request',2025,'FY25 budget-meeting requests','working',maps('J','K',['L'],['M'],'N','O','P','Q',['R']));
  add('FY25_All of SoE','2025-revised-1',2025,'FY25 revised requests (first block)','working',maps('S','T',['U'],['V'],'W','X','Y','Z',['AA']));
  add('FY25_All of SoE','2025-revised-2',2025,'FY25 revised requests (second block)','working',maps('AB','AC',['AD'],['AE'],'AF','AG','AH','AI',['AJ']));
 }
 if(w.sourceId==='fy21-decisions'){
  add('Sheet1','2021-funded',2021,'Funded decisions','final',maps('A','A',['I'],['J'],'M','L','K',null,[]),{sameColumn:true,requested:['B','C'],start:4});
  add('Sheet1','2021-proposed',2021,'Proposed allocation before funding decisions','working',maps('A','A',['D'],['E'],'H','G','F',null,[]),{sameColumn:true,requested:['B','C'],start:4});
 }
 if(w.sourceId==='fy27-sources'){
  for(const name of ['FY27 Budget_ALL','FY26 Budget ALL'])add(name,name,Number('20'+name.slice(2,4)),name.startsWith('FY27')?'All FY27 requests and recorded decisions':'All FY26 requests and recorded decisions','approved',maps('C','H',['M'],['N'],'O',null,'P','Q',[]),{tabular:true,yearColumn:'B',statusColumn:'A',fallbackDescription:'G',requested:['J','K'],requestTotal:'L',category:'D'});
  for(const name of ['FY27 Budget approved','FY26 Budget approved'])add(name,name,2026,name==='FY27 Budget approved'?'Approved schedule (FY26 rows; FY27 tab name)':'FY26 approved distribution schedule','distribution',maps('C','D',['M'],['P'],'Q',null,'R','S',['X','Y','Z']),{tabular:true,yearColumn:'B',statusColumn:'A',fallbackDescription:'H',requested:['J','K'],requestTotal:'L',category:'E',accounts:{provost:'U',school:'V',to:'W'}});
  add('FY27 Budget_APPROVED','2027-distribution',2027,'FY27 SoE distribution working schedule','distribution',maps('C','M',['R'],['S'],'D','E','U','V',[]),{tabular:true,yearColumn:'B',statusColumn:'A',fallbackDescription:'L',requested:['O','P'],requestTotal:'Q',category:'I',referenceSchool:'T',accounts:{school:'F',to:'G'}});
  add('FY26 TA source and accounts','2026-ta',2026,'TA costs at the working rate versus original budget','ta',maps('B','B',[],[], 'H',null,null,'I',[]),{ta:true,requested:['J'],provostTotal:'G',taCount:'C',provostTas:'D',schoolTas:'E',start:11,end:20});
 }
 return out;
}
export function normalizeBudgetWorkbook(workbook){
 const datasets=[];
 for(const p of profiles(workbook)){
  const sheet=workbook.sheets.find(s=>s.name.trim()===p.sheet),m=p.map,rows=[];let unit='';
  for(const row of sheet.rows){if(p.end&&row.row>p.end)continue;if(row.row<(p.start||6)&&!p.tabular)continue;if(p.tabular&&row.row<2)continue;const c=cells(row),read=col=>norm(c[col]?.value),u=read(m.unit),description=read(m.description)||read(p.fallbackDescription);const used=[...(m.base||[]),...(m.non||[]),m.school,m.scc,m.declined,p.provostTotal].filter(Boolean);
   if(p.sameColumn){const hasMoney=[...used,...p.requested].some(k=>amount(c[k])!==null);if(u&&!hasMoney&&!badLabel(u)&&!/no request/i.test(u)){unit=u;continue;}if(!unit||!description||!hasMoney||badLabel(description)||/no request made/i.test(description))continue;}
   else if(p.tabular){if(!u||!description||!read(p.statusColumn))continue;unit=u;}
   else {if(u&&badLabel(u)||description&&badLabel(description))continue;if(u)unit=u;if(!unit||!description)continue;}
   const fiscal=p.yearColumn?Number(read(p.yearColumn)):p.year;if(!Number.isInteger(fiscal)||fiscal<2000||fiscal>2100)continue;
   const notes=m.notes.map(read).filter(Boolean).join(' | '),issues=[];
   if(/ASSUMPTION|no amount|not requested|does not name|no funding source|to confirm/i.test(notes))issues.push('Source note identifies an assumption or an unconfirmed request/funder.');
   if(p.yearColumn&&fiscal!==Number((/FY(\d{2})/.exec(sheet.name)||[])[1])+2000)issues.push(`Row says FY${String(fiscal).slice(-2)}; worksheet name differs.`);
   for(const col of used)if(c[col]?.type==='e')issues.push(`Spreadsheet error at ${c[col].cell}: ${c[col].value}`);
   const base=sum((m.base||[]).map(k=>amount(c[k]))),non=sum((m.non||[]).map(k=>amount(c[k]))),provost=p.provostTotal?amount(c[p.provostTotal]):sum([base,non]),school=amount(c[m.school]),scc=amount(c[m.scc]),declined=amount(c[m.declined]);
   const hasAmounts=[provost,school,scc,declined].some(v=>v!==null);
   const rawTotal=amount(c[m.total]),reported=hasAmounts?rawTotal:null,component=sum([provost,school,scc]),funded=component??(declined!==null&&declined>0?0:null);
   let requested=p.requested?sum(p.requested.map(k=>amount(c[k]))):p.kind==='working'?reported:null;
   if(requested===null&&p.requestTotal){const value=amount(c[p.requestTotal]);if(value!==0||!c[p.requestTotal]?.formula)requested=value;}
   const includesDeclined=totalIncludes(c[m.total],m.declined,row.row),expectedTotal=funded===null?null:funded+(includesDeclined?(declined??0):0);
   if(reported!==null&&expectedTotal!==null&&Math.abs(reported-expectedTotal)>0.02)issues.push('Reported total differs from the mapped funder amounts and any included decline.');
   const ref=p.referenceSchool?amount(c[p.referenceSchool]):null;if(p.referenceSchool&&school!==null&&(ref===null||Math.abs(school-ref)>0.02))issues.push('SoE distribution amount differs from the approved/reference column.');
   const provenance={workbook:workbook.name,sheet:sheet.name,row:row.row,cells:Object.fromEntries(used.filter(k=>c[k]).map(k=>[k,c[k].cell]))};
   rows.push({key:`${p.id}|${row.row}`,year:fiscal,unit,unitKey:unitKey(unit),description,category:p.category?read(p.category):'',status:p.statusColumn?read(p.statusColumn):p.kind,requested,provostBase:base,provostNon:non,provost,school,scc,declined,funded,reported,referenceSchool:ref,notes,issues,accounts:p.accounts?Object.fromEntries(Object.entries(p.accounts).map(([k,v])=>[k,read(v)])):{},taCount:p.taCount?amount(c[p.taCount]):null,provostTas:p.provostTas?amount(c[p.provostTas]):null,schoolTas:p.schoolTas?amount(c[p.schoolTas]):null,hasAmounts,provenance});
  }
  const years=[...new Set(rows.map(r=>r.year))];for(const year of years){const selected=rows.filter(r=>r.year===year);datasets.push({id:workbook.sourceId+'|'+p.id+(years.length>1?'|'+year:''),sourceId:workbook.sourceId,workbook:workbook.name,sheet:sheet.name,year,label:p.label,kind:p.kind,hasAmounts:selected.some(r=>r.hasAmounts),rows:selected,notes:p.kind==='working'?'Working allocations are not funding approvals.':p.kind==='distribution'?'Distribution/reference schedule; source account fields do not establish that a transfer was posted.':p.kind==='ta'?'TA schedule uses the workbook working rate; the original budget is a separate comparison.':'Decisions recorded in the source workbook; this view does not alter current QuickBase approvals.'});}
 }
 return {sourceId:workbook.sourceId,name:workbook.name,sha:workbook.sha,modified:workbook.modified,importedAt:workbook.importedAt,datasets,sheets:workbook.sheets.map(s=>({name:s.name,dimension:s.dimension,rows:s.rows.length,formulas:s.formulas,errors:s.rows.flatMap(r=>r.cells.filter(c=>c.type==='e').map(c=>({cell:c.cell,error:c.value})))}))};
}
