import {createHash} from 'node:crypto';import {createQbTransport} from './budget-hq-qb.mjs';import config from './budget-source-tables.json' with {type:'json'};
const digest=s=>createHash('sha256').update(s).digest('hex');
export function createBudgetSourceStore({transport=createQbTransport(),table=config.snapshots,cacheMs=60000}={}){
 let cache=null,at=0,fields;
 async function query(where){
  if(!fields){if(!/^[a-z0-9]{6,20}$/.test(table||''))throw Error('Budget source storage is unavailable.');const list=await transport.rest('fields?tableId='+table,{method:'GET'});fields={};for(const label of ['Source Key','Source ID','Snapshot SHA','Kind','Payload JSON']){const f=list.find(f=>f.label===label);if(!f)throw Error('Budget source fields missing.');fields[label]=f.id;}}
  const data=[];let total;
  for(let page=0;page<30;page++){const r=await transport.rest('records/query',{body:{from:table,select:Object.values(fields),where:where(fields),sortBy:[{fieldId:3,order:'ASC'}],options:{top:100,skip:data.length}}});if(!Number.isInteger(r.metadata?.totalRecords)||total!==undefined&&total!==r.metadata.totalRecords)throw Error('Snapshot changed during loading.');total=r.metadata.totalRecords;data.push(...r.data);if(data.length===total)break;if(!r.data.length||data.length>total)throw Error('Incomplete snapshot.');}
  if(data.length!==total)throw Error('Incomplete snapshot.');return data.map(r=>Object.fromEntries(Object.entries(fields).map(([k,id])=>[k,r[String(id)]?.value??''])));
 }
 return {async load({fresh=false}={}){
  if(!fresh&&cache&&Date.now()-at<cacheMs)return cache;
  const manifests=await query(f=>`{${f.Kind}.EX.'manifest'}`),workbooks=[];
  if(!manifests.length)throw Error('No workbook sources have been imported.');
  for(const m of manifests){const info=JSON.parse(m['Payload JSON']);if(info.schema!==1||!/^[a-z0-9-]{1,80}$/.test(m['Source ID'])||!/^[a-f0-9]{64}$/.test(m['Snapshot SHA'])||info.sourceId!==m['Source ID']||info.sha!==m['Snapshot SHA']||!Array.isArray(info.chunks))throw Error('Invalid source manifest.');
   const chunks=await query(f=>`{${f.Kind}.EX.'data'}AND{${f['Source ID']}.EX.'${m['Source ID']}'}AND{${f['Snapshot SHA']}.EX.'${m['Snapshot SHA']}'}`);if(chunks.length!==info.chunks.length)throw Error('Snapshot chunk count differs.');const sheets=info.sheets.map(s=>({...s,rows:[]}));
   for(const expected of info.chunks){const found=chunks.find(c=>c['Source Key']===expected.key);if(!found||digest(found['Payload JSON'])!==expected.sha)throw Error('Snapshot integrity failure.');const part=JSON.parse(found['Payload JSON']);const sheet=sheets[part.sheet];if(!sheet||!Array.isArray(part.rows))throw Error('Invalid source chunk.');sheet.rows.push(...part.rows);}
   for(const s of sheets){s.rows.sort((a,b)=>a.row-b.row);if(s.rows.length!==s.rowCount||new Set(s.rows.map(r=>r.row)).size!==s.rows.length)throw Error('Source rows are incomplete or duplicated.');}
   workbooks.push({...info,sheets});
  }
  cache=workbooks;at=Date.now();return workbooks;
 }};
}
