import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';import {join} from 'node:path';
import {pilotStore} from './worker-pilot.mjs';
import {settingsStore} from './report-settings.mjs';
import {unseal,encryptionKey} from './nimbus-store.mjs';
export const REPORT_ID='account-inventory';
const columns=['Cost Object','Cost Object Name','Fund Center','Profit Center','Control','Closed'];
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function inventoryWorker(action,owner,unit,{store=pilotStore,settings=settingsStore,key=encryptionKey,now=()=>new Date()}={}){
 if(owner!=='oconaill'||!['aeroastro','soe-fake'].includes(unit))throw Error('Local-worker inventory pilot is Brian-only.');
 const s=await store(),m=await s.get('latest-report:'+owner+':'+REPORT_ID,{type:'json'}),queueKey='manual-request:'+owner,queue=await s.getWithMetadata(queueKey,{type:'json'}),active=await s.get('active:'+owner,{type:'json'});
 if(action==='status')return {queued:queue?.data.reportId===REPORT_ID&&!queue.data.claimed&&Date.parse(queue.data.expires_at)>now(),running:active?.owner===owner&&active.reportId===REPORT_ID&&active.status==='running',saved:m?.owner===owner&&m.reportId===REPORT_ID?{rows:m.rows,at:m.published_at}:null};
 if(action==='run'){
  if(active?.owner===owner&&active.reportId===REPORT_ID&&active.status==='running')return {running:true};
  const config=await settings(),catalogue=await config.get('catalogue',{type:'json'}),report=catalogue?.reports?.find(r=>r.id===REPORT_ID);
  const sql=(await readFile(join(process.cwd(),'src/account-inventory-query.sql'),'utf8')).split(/\r?\n/).filter(line=>!line.trimStart().startsWith('--')).join('\n').trim().replace(/;$/,'');
  if(report?.runner!=='oracle-tabular-v1'||report.definition?.sql!==sql||report.definition?.output||report.definition.max_rows!==20000||JSON.stringify(report.owners)!=='["oconaill"]')throw Error('The inventory worker report is not configured.');
  if(queue?.data.reportId===REPORT_ID&&!queue.data.claimed&&Date.parse(queue.data.expires_at)>now())return {queued:true};
  const saved=await s.setJSON(queueKey,{owner,unit,reportId:REPORT_ID,requested_at:now().toISOString(),expires_at:new Date(+now()+3600000).toISOString()},queue?{onlyIfMatch:queue.etag}:{onlyIfNew:true});
  if(!saved.modified)throw Error('A worker request changed. Reload.');return {queued:true};
 }
 if(action!=='read'||!m||m.owner!==owner||m.reportId!==REPORT_ID||JSON.stringify(m.columns)!==JSON.stringify(columns)||!Number.isSafeInteger(m.rows)||m.rows<1||m.rows>20000||!Array.isArray(m.chunks)||m.chunks.length>100)throw Error('No verified account-inventory run is available.');
 const accounts=[];
 for(const [i,c]of m.chunks.entries()){
  if(c.id!=='chunk:'+owner+':'+m.job+':'+i)throw Error('Invalid private inventory chunk.');
  const value=unseal(await s.get(c.id,{type:'text'}),key(),c.id);
  if(hash(value)!==c.hash||JSON.stringify(value.columns)!==JSON.stringify(columns)||value.rows.length!==c.rows)throw Error('Account inventory failed integrity verification.');
  for(const row of value.rows){if(!Array.isArray(row)||row.length!==6)throw Error('Invalid inventory row.');accounts.push(Object.fromEntries(['account','name','fundCenter','profitCenter','control','closed'].map((k,j)=>[k,String(row[j]??'')])));}
 }
 if(accounts.length!==m.rows)throw Error('Incomplete account inventory.');
 return {accounts,sha256:hash({columns:m.columns,chunks:m.chunks}),published_at:m.published_at};
}
