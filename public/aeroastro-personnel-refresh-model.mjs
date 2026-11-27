import {readReportCsv} from './aeroastro-refresh-model.mjs';
export const HR_COLUMNS=Object.freeze({department:'Department Name',category:'Employee Type',employeeId:'MIT ID',name:'Full Name',jobTitle:'Job Title',positionId:'Position ID',position:'Position Title',employmentDate:'Current Employment Date',yearsSinceHire:'Yrs Since Last Hire',startDate:'Appointment Begin Date',endDate:'Appointment End Date',visaExpirationDate:'VISA Expiration Date',residencyStatus:'Residency Status',i9ExpirationDate:'I9 Expiration Date',salary:'Annual Salary',hourlyRate:'Hourly Rate',fte:'Employment Percent',officeAddress:'Office Address',officePhone:'Office Phone',email:'EMAIL_ADDRESS',additionalAppointments:'Has Additional Appointments'});
const clean=s=>String(s??'').replace(/^\uFEFF/,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const appointmentKey=row=>JSON.stringify([row.employeeId,row.positionId,row.startDate]);
const date=(value,label)=>{if(!value)return null;let match=/^(\d{4})-(\d{2})-(\d{2})(?:(?:T| )00:00:00(?:\.0+)?Z?)?$/.exec(value),iso;if(match)iso=match.slice(1,4).join('-');else{match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);if(match)iso=match[3]+'-'+match[1].padStart(2,'0')+'-'+match[2].padStart(2,'0');}if(!iso||!Number.isFinite(Date.parse(iso))||new Date(iso+'T00:00:00Z').toISOString().slice(0,10)!==iso)throw Error('Invalid '+label+'; use the original MIT Reports date format.');return iso;};
const number=(value,label,max=1e9)=>{if(!value)return null;const s=value.replace(/[$,%\s]/g,'');if(!/^-?\d+(?:\.\d+)?$/.test(s)||!Number.isFinite(Number(s))||Number(s)<0||Number(s)>max)throw Error('Invalid '+label+'.');return Number(s);};
const yesNo=value=>{if(/^(yes|y|true|1)$/i.test(value))return true;if(/^(no|n|false|0)$/i.test(value)||!value)return false;throw Error('Invalid additional-appointments indicator.');};
export function preparePersonnelRefresh(csv,current,asOf){
 if(!current?.rows?.length||current.unit!=='aeroastro'||!/^\d{4}-\d{2}-\d{2}$/.test(asOf||'')||!Number.isFinite(Date.parse(asOf))||new Date(asOf+'T00:00:00Z').toISOString().slice(0,10)!==asOf||asOf<current.asOf)throw Error('Choose a valid report date at least as recent as the saved roster.');
 const table=readReportCsv(csv,{headerTokens:['departmentname','mitid']}),header=table.findIndex(r=>r.some(c=>clean(c)==='departmentname')&&r.some(c=>clean(c)==='mitid'));
 if(header<0)throw Error('Use the complete CSV export of HR Employee Roster No Prompt.');
 const expected=new Map(Object.entries(HR_COLUMNS).map(([key,label])=>[clean(label),key])),indices=new Map(),headings=table[header];
 headings.forEach((label,i)=>{const key=expected.get(clean(label));if(!key)throw Error('The file contains an unapproved column. Use the original 21-column HR roster export.');if(indices.has(key))throw Error('The HR roster repeats a column.');indices.set(key,i);});
 if(indices.size!==expected.size)throw Error('The upload must include all 21 columns from the HR roster.');
 const uploaded=[],seen=new Set();
 for(const cells of table.slice(header+1)){
  if(cells.length!==headings.length)throw Error('The HR roster rows do not match the headings.');
  const row=Object.fromEntries([...indices].map(([key,i])=>[key,cells[i]]));
  if(row.department!=='Aeronautics and Astronautics')throw Error('Only AeroAstro rows are accepted. Filter Department Name to Aeronautics and Astronautics before exporting.');
  if(!/^\d{9}$/.test(row.employeeId)||!row.name||!row.positionId||!row.category)throw Error('Each appointment needs its MIT ID, name, position ID and employee type.');
  for(const [key,label]of Object.entries(HR_COLUMNS))if(row[key].length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(row[key]))throw Error('Invalid '+label+'.');
  for(const key of ['employmentDate','startDate','endDate','visaExpirationDate','i9ExpirationDate'])row[key]=date(row[key],HR_COLUMNS[key]);
  if(!row.startDate)throw Error('Each appointment needs its begin date.');
  row.openEnded=!row.endDate||row.endDate.startsWith('2999');if(row.openEnded)row.endDate=null;
  if(row.endDate&&row.endDate<row.startDate)throw Error('An appointment ends before its begin date.');
  for(const key of ['salary','hourlyRate','fte','yearsSinceHire'])row[key]=number(row[key],HR_COLUMNS[key],key==='fte'?100:key==='yearsSinceHire'?150:1e9);
  row.additionalAppointments=yesNo(row.additionalAppointments);row.inCurrentRoster=true;row.lastSeenDate=asOf;
  const identity=appointmentKey(row);if(seen.has(identity))throw Error('The roster repeats the same person, position and begin date.');seen.add(identity);uploaded.push(row);
 }
 if(!uploaded.length||uploaded.length>5000)throw Error('Choose a nonempty AeroAstro roster with no more than 5,000 appointments.');
 const previous=new Map();for(const row of current.rows){if(!/^\d{9}$/.test(row.employeeId||''))throw Error('The saved roster needs verified MIT IDs before it can be refreshed.');const k=appointmentKey(row);if(previous.has(k))throw Error('The saved roster contains ambiguous appointments. Ask the site administrator to review it.');previous.set(k,row);}
 const changes=[],rows=uploaded.map(row=>{const old=previous.get(appointmentKey(row));const fields=Object.keys(HR_COLUMNS).filter(k=>JSON.stringify(old?.[k]??null)!==JSON.stringify(row[k]??null));if(!old)changes.push({type:'Added',name:row.name,position:row.position,fields:[]});else if(fields.length||old.inCurrentRoster===false)changes.push({type:old.inCurrentRoster===false?'Returned':'Changed',name:row.name,position:row.position,fields:fields.map(k=>HR_COLUMNS[k])});return {...row,id:old?.id||'pending-'+uploaded.indexOf(row)};});
 let missing=0;for(const old of current.rows)if(!seen.has(appointmentKey(old))){if(old.inCurrentRoster!==false){missing++;changes.push({type:'Not on latest roster',name:old.name,position:old.position,fields:[]});}rows.push({...old,inCurrentRoster:false,lastSeenDate:old.lastSeenDate||current.asOf});}
 if(rows.length>5000)throw Error('The combined roster exceeds the supported size. Ask the site administrator to archive older records safely.');
 return {rows,changes,summary:{uploaded:uploaded.length,people:new Set(uploaded.map(r=>r.employeeId)).size,added:changes.filter(r=>r.type==='Added').length,changed:changes.filter(r=>r.type==='Changed'||r.type==='Returned').length,missing,retainedFormer:rows.filter(r=>r.inCurrentRoster===false).length}};
}
