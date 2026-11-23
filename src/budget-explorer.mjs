import {isFacultyHireSlot} from '../public/budget-model.mjs';
import access from './access.cjs';
import {qbRequest} from './nimbus-store.mjs';
const TABLE='br8dehttq';
const LABELS=['Budget Fiscal Year','Department','Original Request Description','Revised Request Description','Request Nimbus category','Request Amount','Recurring (base) - DLC','Non-recurring (non-base) - DLC','Provost Recurring (base) - Approved','Provost Non-recurring (non-base) - Approved','SoE Non-recurring (non-base) - SoE_Approved','Declined','Declined Final','Historical allocation - funder unresolved','Status of Initial Request'];
const OPTIONAL=['SCC Non-recurring (non-base) - Approved','Workbook Source JSON','Provost Recurring (base) - SoE','Provost Non-recurring (non-base) - SoE','SoE Non-recurring (non-base) - SoE','SCC Non-recurring (non-base) - SoE request'];
const safeValue=value=>{if(value===null||value===undefined)return null;if(typeof value==='number'||typeof value==='boolean')return value;return String(value).slice(0,2000);};
async function getFields(){const response=await fetch(`https://api.quickbase.com/v1/fields?tableId=${TABLE}`,{headers:{'QB-Realm-Hostname':'mit.quickbase.com',Authorization:`QB-USER-TOKEN ${process.env.NIMBUS_QB_TOKEN}`},signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Quickbase field metadata unavailable.');const data=await response.json();const result=Array.isArray(data)?data:data.fields;if(!Array.isArray(result)||!result.length)throw Error('Quickbase field metadata missing.');return result;}
export async function loadBudgetRecords({fields=getFields,query=qbRequest}={}){
  const metadata=await fields(),selected=LABELS.map(label=>metadata.find(field=>field.label===label));
  if(selected.some(field=>!field||!Number.isInteger(field.id)))throw Error('A required budget field is unavailable.');
  selected.push(...OPTIONAL.map(label=>metadata.find(field=>field.label===label)).filter(field=>field&&Number.isInteger(field.id)));
  const ids=[3,...selected.map(field=>field.id)],raw=[];let expected;
  for(let page=0;page<20;page++){
   const result=await query('records/query',{from:TABLE,select:ids,sortBy:[{fieldId:3,order:'ASC'}],options:{top:500,skip:raw.length}});
   if(!Array.isArray(result.data)||!Number.isInteger(result.metadata?.totalRecords)||(expected!==undefined&&expected!==result.metadata.totalRecords))throw Error('Budget records changed while loading.');
   expected=result.metadata.totalRecords;raw.push(...result.data);
   if(raw.length===expected)break;
   if(!result.data.length||raw.length>expected)throw Error('Incomplete budget records.');
  }
  if(raw.length!==expected||new Set(raw.map(row=>String(row['3']?.value))).size!==raw.length)throw Error('Incomplete or duplicate budget records.');
  return {selected,raw,total:expected};
}
export const BUDGET_SOURCE_URL=`https://mit.quickbase.com/nav/app/br8deedpt/table/${TABLE}/action/td`;
export {safeValue};
export function createBudgetHandler({authorize=access.authorize,fields=getFields,query=qbRequest}={}){return async event=>{
 const auth=await authorize(event,{scope:'school',minimum:'admin'});if(auth.statusCode)return auth;
 if(event.httpMethod!=='GET')return {statusCode:405,headers:access.noStore,body:'GET required.'};
 try{
  const {selected,raw,total:expected}=await loadBudgetRecords({fields,query});
  const rows=raw.map(row=>Object.fromEntries(selected.map(field=>[field.label,field.label==='Workbook Source JSON'?String(row[String(field.id)]?.value||'').slice(0,50000):safeValue(row[String(field.id)]?.value)]))).filter(row=>!isFacultyHireSlot(row));
  return {statusCode:200,headers:{...access.noStore,'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({fields:selected.map(field=>({id:field.id,label:field.label})),rows,total:rows.length,sourceUrl:`https://mit.quickbase.com/nav/app/br8deedpt/table/${TABLE}/action/td`})};
 }catch(error){console.error('Budget Explorer:',error.message);return {statusCode:502,headers:{...access.noStore,'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({error:'Budget data is temporarily unavailable.'})};}
};}
export const handler=createBudgetHandler();
