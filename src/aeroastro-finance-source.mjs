import {PERSONNEL_EXTRA_FIELDS} from '../public/aeroastro-personnel-fields.mjs';
// Verified under Cognos department D_AEROASTRO before the user-authorized expansion.
// Never infer department ownership from a fund-center name or a numeric range.
export const AEROASTRO_PROFIT_CENTERS=Object.freeze(['061000','061001','061002','061004','061005','061006','061007','061090','061091','061092','061093','061094','061095','061096','061097','061098','061099']);
const approvedProfitCenters=new Set(AEROASTRO_PROFIT_CENTERS);
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const text=(v,max=500)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('Invalid source text');return v;};
const number=v=>{if(v===null||v===undefined||v==='')return null;if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e13)throw Error('Invalid source amount');return v;};
export function validateFinanceSource(input,kind,now=new Date()){
 if(input?.schema!==1||input.unit!=='aeroastro'||input.kind!==kind||!['accounts','people'].includes(kind)||!validDate(input.asOf)||input.asOf>now.toISOString().slice(0,10)||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>5000)throw Error('Invalid AeroAstro source');
 text(input.label,300);const seen=new Set();
 for(const row of input.rows){if(!row||typeof row!=='object')throw Error('Invalid source row');
  if(kind==='accounts'){
   if(!/^\d{7}$/.test(row.account||'')||seen.has(row.account)||!approvedProfitCenters.has(String(row.profitCenter||'').replace(/^P(?=\d{6}$)/,''))||!['Open','Closed'].includes(row.status))throw Error('Account source must contain unique accounts belonging to verified AeroAstro profit centers');seen.add(row.account);text(row.name);for(const k of ['currentBalance','ytdExpenses','commitments'])number(row[k]);for(const k of ['control','fundCenter','fundCenterId','profitCenterName','pool'])if(row[k]!==undefined)text(row[k]);if(row.history!==undefined&&(!Array.isArray(row.history)||row.history.length>3))throw Error('Invalid annual expense history');for(const h of row.history||[]){if(!Number.isInteger(h.year)||h.year<2000||h.year>Number(input.asOf.slice(0,4))+1)throw Error('Invalid history year');number(h.expenses);}
  }else{
   const keys=['id','name','email','category','jobTitle','position','positionId','startDate','endDate','openEnded','salary','hourlyRate','fte','additionalAppointments',...PERSONNEL_EXTRA_FIELDS];if(Object.keys(row).some(k=>!keys.includes(k)))throw Error('Unapproved personnel field');text(row.id,100);if(seen.has(row.id))throw Error('Duplicate appointment');seen.add(row.id);for(const k of ['name','email','category','jobTitle','position','positionId'])text(row[k]||'');for(const k of ['startDate','endDate'])if(row[k]!==null&&!validDate(row[k]))throw Error('Invalid appointment date');for(const k of ['salary','hourlyRate','fte'])number(row[k]);for(const key of PERSONNEL_EXTRA_FIELDS){const value=row[key];if(value===null||value===undefined)continue;if(['employmentDate','visaExpirationDate','i9ExpirationDate'].includes(key)){if(!validDate(value))throw Error('Invalid personnel date');}else if(key==='yearsSinceHire'){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>150)throw Error('Invalid service years');}else{text(value);if(key==='employeeId'&&!/^\d{9}$/.test(value))throw Error('Invalid MIT employee ID');}}if(typeof row.openEnded!=='boolean'||typeof row.additionalAppointments!=='boolean')throw Error('Invalid appointment flags');
  }
 }
 return input;
}
