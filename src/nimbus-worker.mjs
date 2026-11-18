import {createHash} from 'node:crypto';
import {createSnapshotRepository} from './nimbus-store.mjs';
import {validRows} from './nimbus-data.mjs';
export const NIMBUS_COLUMNS=['TRANSACTION_KEY','FISCAL_YEAR','FISCAL_PERIOD','SUPERVISR_MIT_ID','APPROVED_DATE_SERIAL','BUDGET_DOCUMENT_TYPE','BUDGET_DOCUMENT_TYPE_CODE','COST_COLLECTOR_ID','COST_COLLECTOR_NAME','GL_ACCOUNT_ID','GL_ACCOUNT_NAME','NIMBUS_LINE_ITEM_TEXT','PUBLIC_COMMENT','SUBMITTED_BY_USER','APPROVED_BY_USER','TRANSACTION_NUMBER','TRANSACTION_LINE_NUMBER','BASE_AMOUNT','NON_BASE_AMOUNT'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function checkNimbusPilot(job){
 const output=job.definition?.output;
 if(job.owner!=='oconaill'||job.reportId!=='nimbus'||output?.kind!=='nimbus-snapshot-v1'||output.scope!=='school'||output.visibility!=='owner-pilot'||!Object.keys(output).every(k=>['kind','scope','visibility'].includes(k))||!/^[a-f0-9-]{36}$/.test(job.id))throw Error('Nimbus automatic publication is restricted to Brian’s private SoE pilot.');
 return 'worker-pilot-oconaill-school';
}
export async function saveNimbusPilotBatch(job,body,repository=createSnapshotRepository()){
 const scope=checkNimbusPilot(job);
 if(JSON.stringify(body.columns)!==JSON.stringify(NIMBUS_COLUMNS))throw Error('Nimbus column order does not match the approved export.');
 if(!Number.isSafeInteger(body.index)||body.index<0)throw Error('Invalid Nimbus batch index.');
 const rows=validRows(body.rows,null,1000),digest=hash(rows),id=scope+':chunk:'+digest;
 let existing;try{existing=await repository.get(scope,id);}catch{}
 if(existing&&hash(existing)===digest)return {id,hash:digest,rows:rows.length,content_addressed:true};
 if(repository.putCompressed)await repository.putCompressed(scope,id,rows);else await repository.put(scope,id,rows);
 if(body.index%100===0){const verified=await repository.get(scope,id);if(hash(verified)!==digest)throw Error('Nimbus saved batch could not be verified.');}
 return {id,hash:digest,rows:rows.length,content_addressed:true};
}
export async function readNimbusPilotPage(manifest,owner,reportId,page,repository=createSnapshotRepository()){
 if(owner!=='oconaill'||reportId!=='nimbus'||manifest.owner!==owner||manifest.reportId!==reportId||!['quickbase-nimbus-pilot-v1','quickbase-nimbus-pilot-v2'].includes(manifest.storage)||manifest.scope!=='worker-pilot-oconaill-school'||!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(manifest.rows)||manifest.rows<1||!Array.isArray(manifest.chunks)||manifest.chunks.length>8000||!Number.isSafeInteger(manifest.rows)||manifest.rows>2000000)throw Error('Invalid Nimbus pilot scope.');
 if(JSON.stringify(manifest.columns)!==JSON.stringify(NIMBUS_COLUMNS)||!/^[a-f0-9-]{36}$/.test(manifest.job))throw Error('Invalid Nimbus pilot manifest.');
 const pages=Math.max(1,Math.ceil(manifest.rows/100));page=Math.min(page,pages);const start=(page-1)*100,end=Math.min(start+100,manifest.rows),rows=[];let offset=0;
 for(const [i,chunk]of manifest.chunks.entries()){
  const expected=chunk.content_addressed===true?manifest.scope+':chunk:'+chunk.hash:manifest.scope+':'+manifest.job+':'+i;
  if(!/^[a-f0-9]{64}$/.test(chunk.hash)||chunk.id!==expected||!Number.isSafeInteger(chunk.rows)||chunk.rows<1||chunk.rows>1000)throw Error('Invalid Nimbus pilot chunk.');
  if(offset+chunk.rows>start&&offset<end){const value=await repository.get(manifest.scope,chunk.id);if(hash(value)!==chunk.hash||value.length!==chunk.rows)throw Error('Nimbus pilot integrity check failed.');validRows(value,null,1000);rows.push(...value.slice(Math.max(0,start-offset),end-offset));}
  offset+=chunk.rows;
 }
 if(offset!==manifest.rows)throw Error('Incomplete Nimbus pilot manifest.');
 return {columns:manifest.columns,rows,total:manifest.rows,page,pages,published_at:manifest.published_at,pilot:true};
}
