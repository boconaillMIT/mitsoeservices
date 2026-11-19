import {randomUUID} from 'node:crypto';
import {createQbTransport} from './budget-hq-qb.mjs';
import config from './rct-tables.json' with {type:'json'};
export const MAX_PDF_BYTES=3*1024*1024;
export const VERSION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const proposalId=value=>/^FY27-RCT2\|[a-z-]{1,40}$/.test(value||'');
export function validatePdf(body){
 if(!body||Object.keys(body).some(k=>!['id','filename','content'].includes(k))||!proposalId(body.id)||typeof body.filename!=='string'||body.filename.length>180||!body.filename.toLowerCase().endsWith('.pdf')||/[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(body.filename)||body.filename!==body.filename.trim()||body.filename.startsWith('.')||typeof body.content!=='string'||!body.content.length||body.content.length>Math.ceil(MAX_PDF_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.content))throw Error('Choose a PDF file of 3 MB or smaller.');
 const bytes=Buffer.from(body.content,'base64');
 if(!bytes.length||bytes.length>MAX_PDF_BYTES||bytes.toString('base64')!==body.content||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Choose a valid PDF file of 3 MB or smaller.');
 return bytes;
}
// Each upload creates its own record: older revisions are never replaced.
export function createRctVersions({transport=createQbTransport(),table=config.versions,uuid=randomUUID,now=()=>new Date(),fetcher=fetch,token=()=>process.env.NIMBUS_QB_TOKEN}={}){
 let cached;
 async function fields(){if(cached)return cached;if(!/^[a-z0-9]{6,20}$/.test(table||''))throw Error('Proposal version storage is not configured.');const list=await transport.rest('fields?tableId='+table,{method:'GET'});cached={};for(const label of ['Key','Proposal Key','File','Uploaded By','Uploaded At']){const f=list.find(f=>f.label===label);if(!f)throw Error('Proposal version storage is incomplete.');cached[label]=f.id;}return cached;}
 async function list(id){
  if(!proposalId(id))throw Error('Invalid proposal.');const f=await fields();
  const r=await transport.rest('records/query',{body:{from:table,select:[3,...Object.values(f)],where:`{${f['Proposal Key']}.EX.'${id}'}`,options:{top:1000}}});
  if((r.metadata?.totalRecords??r.data.length)!==r.data.length)throw Error('Incomplete proposal versions.');
  return r.data.map(row=>{const attachment=row[String(f.File)].value,version=attachment?.versions?.[0];if(!VERSION_ID.test(row[String(f.Key)].value)||!version||version.versionNumber!==1)throw Error('Invalid proposal version.');return {id:row[String(f.Key)].value,rid:String(row['3'].value),filename:version.fileName,by:row[String(f['Uploaded By'])].value,at:row[String(f['Uploaded At'])].value};}).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
 }
 return {list,async upload(body,actor){
  validatePdf(body);const f=await fields(),id=uuid(),values={Key:id,'Proposal Key':body.id,File:{fileName:body.filename,data:body.content},'Uploaded By':actor,'Uploaded At':now().toISOString()};
  const r=await transport.rest('records',{body:{to:table,data:[Object.fromEntries(Object.entries(values).map(([key,value])=>[f[key],{value}]))],fieldsToReturn:[3]}});
  if(r.metadata?.createdRecordIds?.length!==1)throw Error('Upload was not confirmed.');
  return {id};
 },async download(proposal,version){
  const row=(await list(proposal)).find(r=>r.id===version);if(!row)return null;const f=await fields();
  const r=await fetcher(`https://api.quickbase.com/v1/files/${table}/${row.rid}/${f.File}/1`,{headers:{'QB-Realm-Hostname':'mit.quickbase.com',Authorization:'QB-USER-TOKEN '+token()},signal:AbortSignal.timeout(20000)});
  if(!r.ok||Number(r.headers.get('content-length'))>Math.ceil(MAX_PDF_BYTES/3)*4+2)throw Error('Proposal version is unavailable.');
  const encoded=await r.text(),content=encoded.startsWith('"')?JSON.parse(encoded):encoded;
  const bytes=validatePdf({id:proposal,filename:row.filename,content});return {...row,bytes};
 }};
}

