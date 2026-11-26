import {randomUUID} from 'node:crypto';
import {createQbTransport} from './budget-hq-qb.mjs';
import config from './dr-tables.json' with {type:'json'};
import {ID,fail} from '../public/dr-model.mjs';
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const unxml=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const LABELS={requests:['Key','Owner','Organization Key','Record JSON','Revision'],files:['Key','Request Key','File','Uploaded By','Uploaded At'],organizations:['Key','Name']};
export function createDrStore({transport=createQbTransport(),tables=config,uuid=randomUUID,fetcher=fetch,token=()=>process.env.NIMBUS_QB_TOKEN}={}){
 const cache={};
 async function fields(kind){if(cache[kind])return cache[kind];if(!/^[a-z0-9]{6,20}$/.test(tables[kind]||''))throw Error('Donation Requests storage is not configured.');const list=await transport.rest('fields?tableId='+tables[kind],{method:'GET'}),f={};for(const label of LABELS[kind]){const field=list.find(x=>x.label===label);if(!field)throw Error('Donation Requests storage is incomplete.');f[label]=field.id;}return cache[kind]=f;}
 async function query(kind,where){const f=await fields(kind),rows=[];let expected;
  for(let page=0;page<100;page++){const r=await transport.rest('records/query',{body:{from:tables[kind],select:[3,...Object.values(f)],where:where(f),options:{top:1000,skip:rows.length}}});rows.push(...r.data);expected=r.metadata?.totalRecords;if(expected===undefined&&r.data.length===1000)throw Error('Incomplete request results.');if(expected===undefined||rows.length>=expected||!r.data.length)break;}
  if(expected!==undefined&&rows.length!==expected)throw Error('Incomplete request results.');return rows;
 }
 const eq=(field,value)=>{if(!/^[a-zA-Z0-9._-]{1,80}$/.test(value))fail('Invalid identifier.');return `{${field}.EX.'${value}'}`;};
 const parse=(row,f)=>{const data=JSON.parse(row[String(f['Record JSON'])].value);if(data.revision!==row[String(f.Revision)].value||data.owner!==row[String(f.Owner)].value)throw Error('Request metadata differs.');return data;};
 async function get(id){if(!ID.test(id||''))return null;const f=await fields('requests'),rows=await query('requests',f=>eq(f.Key,id));return rows[0]?{row:rows[0],record:parse(rows[0],f)}:null;}
 async function values(kind,vals){const f=await fields(kind);return Object.fromEntries(Object.entries(vals).map(([key,value])=>[f[key],{value}]));}
 return {
  async list({owner}={}){const f=await fields('requests');return (await query('requests',f=>owner?eq(f.Owner,owner):`{${f.Key}.XEX.''}`)).map(row=>parse(row,f));},
  async get(id){return (await get(id))?.record||null;},
  async create(record){
   try{const data=await values('requests',{Key:record.id,Owner:record.owner,'Organization Key':record.organizationId||'','Record JSON':JSON.stringify(record),Revision:record.revision});const r=await transport.rest('records',{body:{to:tables.requests,data:[data]}});if(r.metadata?.createdRecordIds?.length!==1)throw Error('Request creation not confirmed.');return record;}
   catch(error){const found=await get(record.id);if(found?.record.owner===record.owner)return found.record;if(found)fail('Request identifier is already in use.',409);throw error;}
  },
  async save(record,expected){
   const f=await fields('requests'),current=await get(record.id);if(!current)fail('Request not found.',404);if(current.record.revision!==expected)fail('This request changed. Reload before saving.',409);
   const info=await transport.native(tables.requests,'API_GetRecordInfo',`<rid>${current.row['3'].value}</rid>`),updateId=/<update_id>\s*([^<\s]+)\s*<\/update_id>/.exec(info)?.[1];
   const field=[...info.matchAll(/<field\b[^>]*>([\s\S]*?)<\/field>/g)].find(m=>new RegExp(`<fid>\\s*${f.Revision}\\s*</fid>`).test(m[1]));
   if(!updateId||unxml(/<value>([\s\S]*?)<\/value>/.exec(field?.[1]||'')?.[1]||'')!==expected)fail('This request changed. Reload before saving.',409);
   const vals={'Record JSON':JSON.stringify(record),Revision:record.revision,'Organization Key':record.organizationId||''};
   try{await transport.native(tables.requests,'API_EditRecord',`<rid>${current.row['3'].value}</rid><update_id>${xml(updateId)}</update_id>`+Object.entries(vals).map(([key,value])=>`<field fid="${f[key]}">${xml(value)}</field>`).join(''));}
   catch(error){if(error.qbCode)fail('This request changed. Reload before saving.',409);throw error;}return record;
  },
  async organizations(){const f=await fields('organizations');return (await query('organizations',f=>`{${f.Key}.XEX.''}`)).map(row=>({id:row[String(f.Key)].value,name:row[String(f.Name)].value}));},
  async organization(name,id){
   const list=await this.organizations();if(id){const found=list.find(o=>o.id===id);if(!found)fail('Choose an existing organization or create a new one.');return found;}
   const match=list.find(o=>o.name.toLowerCase()===name.toLowerCase());if(match)return match;
   const next={id:uuid(),name},data=await values('organizations',{Key:next.id,Name:name});const result=await transport.rest('records',{body:{to:tables.organizations,data:[data]}});if(result.metadata?.createdRecordIds?.length!==1)throw Error('Organization creation not confirmed.');return next;
  },
  async upload(requestId,body,actor){
   const id=uuid(),data=await values('files',{Key:id,'Request Key':requestId,File:{fileName:body.filename,data:body.content},'Uploaded By':actor,'Uploaded At':new Date().toISOString()});
   const r=await transport.rest('records',{body:{to:tables.files,data:[data]}});if(r.metadata?.createdRecordIds?.length!==1)throw Error('Upload not confirmed.');return id;
  },
  async download(requestId,id){
   if(!ID.test(requestId||'')||!ID.test(id||''))return null;const f=await fields('files'),rows=await query('files',f=>eq(f.Key,id)+'AND'+eq(f['Request Key'],requestId)),row=rows[0];if(!row)return null;
   const versions=row[String(f.File)].value?.versions;if(versions?.length!==1||versions[0].versionNumber!==1)throw Error('Attachment versions differ.');
   const response=await fetcher(`https://api.quickbase.com/v1/files/${tables.files}/${row['3'].value}/${f.File}/1`,{headers:{'QB-Realm-Hostname':'mit.quickbase.com',Authorization:'QB-USER-TOKEN '+token()},signal:AbortSignal.timeout(20000)});
   if(!response.ok||Number(response.headers.get('content-length'))>4200000)throw Error('Attachment unavailable.');const encoded=await response.text();if(encoded.length>4200000)throw Error('Attachment too large.');return {filename:versions[0].fileName,content:encoded.startsWith('"')?JSON.parse(encoded):encoded};
  }
 };
}
