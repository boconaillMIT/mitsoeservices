import {createHash,createCipheriv,createDecipheriv,hkdfSync,randomBytes,randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import access from './access.cjs';
import units from './units.cjs';
import policy from './policy.cjs';
export const MAX_FILE_BYTES=4*1024*1024,MAX_UNIT_FILES=500;
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const EXT=/\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf|png|jpe?g|gif|webp)$/i;
export function validFilename(value){return typeof value==='string'&&value.length>=1&&value.length<=180&&!/[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value)&&value===value.trim()&&!value.startsWith('.')&&EXT.test(value);}
const hash=value=>createHash('sha256').update(value).digest('hex');
export function fileKey(){if(!process.env.UNIT_FILES_DATA_KEY||process.env.UNIT_FILES_DATA_KEY.length<32)throw Error('File encryption is not configured.');return Buffer.from(hkdfSync('sha256',process.env.UNIT_FILES_DATA_KEY,'MITSOEServices unit files '+policy.deploymentName(),'unit-files-v1',32));}
const aad=m=>Buffer.from(JSON.stringify([m.id,m.unit,m.audience,m.filename,m.size,m.sha256,m.uploaded_by,m.uploader_name,m.uploaded_at,...(m.access_version?[m.access_version,m.storage_key,m.access_history]:[])]));
export function encryptFile(bytes,meta,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(meta));const body=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]);}
export function decryptFile(value,meta,key){const bytes=Buffer.from(value);if(bytes.length!==meta.size+28)throw Error('Invalid file length.');const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(aad(meta));decipher.setAuthTag(bytes.subarray(12,28));const plain=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]);if(hash(plain)!==meta.sha256)throw Error('File integrity check failed.');return plain;}
export async function filesStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'mitsoeservices-unit-files-'+policy.deploymentName(),consistency:'strong'});}
function validMeta(m,unit,audience){return m&&m.unit===unit&&m.audience===audience&&ID.test(m.id)&&validFilename(m.filename)&&Number.isSafeInteger(m.size)&&m.size>0&&m.size<=MAX_FILE_BYTES&&/^[a-f0-9]{64}$/.test(m.sha256)&&policy.validUsername(m.uploaded_by)&&typeof m.uploader_name==='string'&&m.uploader_name.length<=160&&typeof m.uploaded_at==='string'&&Number.isFinite(Date.parse(m.uploaded_at));}
function readIndex(entry,unit,audience){
 if(!entry)return {schema:1,unit,audience,files:[]};
 const v=entry.data;
 if(!v||v.schema!==1||v.unit!==unit||v.audience!==audience||!Array.isArray(v.files)||v.files.length>MAX_UNIT_FILES||v.files.some(m=>!validMeta(m,unit,audience))||new Set(v.files.map(m=>m.id)).size!==v.files.length||!entry.etag)throw Error('Invalid file index.');
 return v;
}
const objectKey=m=>m.storage_key||'file:'+m.unit+':'+m.audience+':'+m.id;
function signedIndex(unit,files,key){const value={schema:2,unit,files};return {...value,mac:createHmac('sha256',key).update('unit-files-index-v2:'+JSON.stringify(value)).digest('hex')};}
function checkedIndex(entry,unit,key){
 const v=entry?.data;
 if(!entry?.etag||v?.schema!==2||v.unit!==unit||!Array.isArray(v.files)||v.files.length>MAX_UNIT_FILES*2||new Set(v.files.map(m=>m.id)).size!==v.files.length||v.files.some(m=>!validMeta(m,unit,m.audience)||!['full','limited'].includes(m.audience)||m.access_version&&(!ID.test(m.access_version)||m.storage_key!=='file:'+unit+':'+m.audience+':'+m.id+':'+m.access_version||!Array.isArray(m.access_history)||m.access_history.length>20)))throw Error('Invalid unit file index.');
 const expected=signedIndex(unit,v.files,key).mac;
 if(!/^[a-f0-9]{64}$/.test(v.mac||'')||!timingSafeEqual(Buffer.from(v.mac,'hex'),Buffer.from(expected,'hex')))throw Error('Unit file index integrity failure.');return v;
}
async function unitIndex(s,unit,key){
 let entry=await s.getWithMetadata('index:'+unit,{type:'json'});
 if(!entry){
  const old=await Promise.all(['full','limited'].map(async audience=>readIndex(await s.getWithMetadata('index:'+unit+':'+audience,{type:'json'}),unit,audience)));
  await s.setJSON('index:'+unit,signedIndex(unit,old.flatMap(v=>v.files),key),{onlyIfNew:true});entry=await s.getWithMetadata('index:'+unit,{type:'json'});
 }
 return {entry,index:checkedIndex(entry,unit,key)};
}
function mayMove(auth,meta){
 if(auth.role==='admin')return true;
 return meta.uploaded_by===auth.kerberos&&['full','limited'].every(a=>(policy.CAPABILITIES[policy.effectiveRole(auth.policy?.data,auth.kerberos,meta.unit,a)]||0)>=2);
}
// Read metadata only, without creating/migrating indexes or opening file bodies.
export async function readFileReview({store=filesStore,key=fileKey,scopes=Object.keys(units.ALL_UNITS)}={}){
 const s=await store(),secret=key();
 const groups=await Promise.all(scopes.map(async unit=>{
  if(!Object.hasOwn(units.ALL_UNITS,unit))throw Error('Invalid review unit.');
  const entry=await s.getWithMetadata('index:'+unit,{type:'json'});
  const files=entry?checkedIndex(entry,unit,secret).files:(await Promise.all(['full','limited'].map(async audience=>readIndex(await s.getWithMetadata('index:'+unit+':'+audience,{type:'json'}),unit,audience)))).flatMap(v=>v.files);
  return files.map(m=>({unit,id:m.id,filename:m.filename,audience:m.audience,uploaded_by:m.uploaded_by,uploaded_at:m.uploaded_at,changes:(m.access_history||[]).map(a=>{
   if(!['full','limited'].includes(a.from)||!['full','limited'].includes(a.to)||a.from===a.to||!policy.validUsername(a.by)||!Number.isFinite(Date.parse(a.at)))throw Error('Invalid access history.');
   return {from:a.from,to:a.to,by:a.by,at:a.at};
  })}));
 }));
 return groups.flat();
}
export function createUnitFilesHandler({authorize=access.authorize,store=filesStore,key=fileKey,now=()=>new Date(),uuid=randomUUID}={}){return async event=>{
 const base={...access.noStore,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'},reply=(status,data)=>({statusCode:status,headers:{...base,'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'GET or POST required.'});
 const params=event.queryStringParameters||{},unit=params.unit,audience=params.audience;
 if(!Object.hasOwn(units.ALL_UNITS,unit||'')||!['full','limited'].includes(audience))return reply(404,{error:'Unit page not found.'});
 const auth=await authorize(event,{scope:unit,audience,minimum:event.httpMethod==='POST'?'write':'read'});if(!auth.user)return auth;
 let body;
 if(event.httpMethod==='POST'){
  const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!process.env.APP_ORIGIN||h.origin!==process.env.APP_ORIGIN||h['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
  if(typeof event.body!=='string'||event.body.length>Math.ceil(MAX_FILE_BYTES/3)*4+1000)return reply(413,{error:'Files must be 4 MB or smaller.'});
  try{body=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid upload.'});}
 }
 try{
  const s=await store(),secret=key();let {entry,index}=await unitIndex(s,unit,secret);
  if(event.httpMethod==='POST'&&body?.action==='move'){
   if(Object.keys(body).some(k=>!['action','id','to','version'].includes(k))||!ID.test(body.id||'')||!['full','limited'].includes(body.to)||body.to===audience||!ID.test(body.version||''))return reply(400,{error:'Choose the other access page for this file.'});
   const old=index.files.find(m=>m.id===body.id&&m.audience===audience);if(!old)return reply(404,{error:'File not found on this page.'});
   if(!mayMove(auth,old))return reply(403,{error:'Only your unit administrator or the original uploader with write access to both pages may change file access.'});
   const target=await authorize(event,{scope:unit,audience:body.to,minimum:'write'});if(!target.user)return target;
   if((old.access_version||old.id)!==body.version)return reply(409,{error:'The file access changed. Reload before trying again.'});
   if(index.files.filter(m=>m.audience===body.to).length>=MAX_UNIT_FILES)return reply(409,{error:'The destination page has reached its file limit.'});
   const bytes=decryptFile(await s.get(objectKey(old),{type:'arrayBuffer'}),old,secret),revision=uuid();
   const meta={...old,audience:body.to,access_version:revision,storage_key:'file:'+unit+':'+body.to+':'+old.id+':'+revision,access_history:[...(old.access_history||[]),{from:audience,to:body.to,by:auth.kerberos,at:now().toISOString()}].slice(-20)};
   const saved=await s.set(objectKey(meta),encryptFile(bytes,meta,secret),{onlyIfNew:true});if(!saved.modified)throw Error('Revision already exists.');
   for(let attempt=0;attempt<5;attempt++){
    if(attempt)({entry,index}=await unitIndex(s,unit,secret));
    const current=index.files.find(m=>m.id===old.id);
    if(!current||current.audience!==audience||(current.access_version||current.id)!==body.version)return reply(409,{error:'Another access change won. Reload to see the current page.'});
    if(index.files.filter(m=>m.audience===body.to).length>=MAX_UNIT_FILES)return reply(409,{error:'The destination page has reached its file limit.'});
    const changed=await s.setJSON('index:'+unit,signedIndex(unit,index.files.map(m=>m.id===old.id?meta:m),secret),{onlyIfMatch:entry.etag});
    if(changed.modified)return reply(200,{moved:true,file:meta});
   }
   return reply(409,{error:'The file list changed. Reload before trying again.'});
  }
  if(event.httpMethod==='POST'){
   if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['filename','content'].includes(k))||!validFilename(body.filename)||typeof body.content!=='string'||!body.content.length||body.content.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.content))return reply(400,{error:'Choose a supported file with a valid filename.'});
   const bytes=Buffer.from(body.content,'base64');if(!bytes.length||bytes.length>MAX_FILE_BYTES)return reply(413,{error:'Choose a nonempty file of 4 MB or smaller.'});if(bytes.toString('base64')!==body.content)return reply(400,{error:'Invalid file encoding.'});
   const meta={id:uuid(),unit,audience,filename:body.filename,size:bytes.length,sha256:hash(bytes),uploaded_by:auth.kerberos,uploader_name:typeof auth.user.name==='string'?auth.user.name.trim().slice(0,160):'',uploaded_at:now().toISOString()};
   if(!validMeta(meta,unit,audience))throw Error('Invalid upload identity.');
   if(index.files.filter(m=>m.audience===audience).length>=MAX_UNIT_FILES)return reply(409,{error:'This page has reached its file limit.'});
   const saved=await s.set(objectKey(meta),encryptFile(bytes,meta,secret),{onlyIfNew:true});if(!saved.modified)throw Error('File ID already exists.');
   for(let attempt=0;attempt<5;attempt++){
    if(attempt)({entry,index}=await unitIndex(s,unit,secret));
    if(index.files.filter(m=>m.audience===audience).length>=MAX_UNIT_FILES)return reply(409,{error:'This page has reached its file limit.'});
    const changed=await s.setJSON('index:'+unit,signedIndex(unit,[meta,...index.files],secret),{onlyIfMatch:entry.etag});if(changed.modified)return reply(201,{file:meta});
   }
   return reply(409,{error:'Other uploads changed the file list. Reload and try again.'});
  }
  if(params.action==='download'){
   if(!ID.test(params.id||''))return reply(404,{error:'File not found on this page.'});
   const meta=index.files.find(m=>m.id===params.id&&m.audience===audience);if(!meta)return reply(404,{error:'File not found on this page.'});
   const plain=decryptFile(await s.get(objectKey(meta),{type:'arrayBuffer'}),meta,secret);
   const current=(await unitIndex(s,unit,secret)).index.files.find(m=>m.id===meta.id&&m.audience===audience);
   if(!current||(current.access_version||current.id)!==(meta.access_version||meta.id))return reply(409,{error:'The file access changed. Reload before downloading.'});
   const fallback=meta.filename.replace(/[^\x20-\x7e]|["\\]/g,'_'),encoded=encodeURIComponent(meta.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
   return {statusCode:200,headers:{...base,'Content-Type':'application/octet-stream','Content-Length':String(plain.length),'Content-Disposition':`attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,'Content-Security-Policy':"default-src 'none'; sandbox"},body:plain};
  }
  if(params.action)return reply(400,{error:'Unknown file action.'});
  return reply(200,{unit,audience,canUpload:auth.canWrite,maxBytes:MAX_FILE_BYTES,files:index.files.filter(m=>m.audience===audience).map(m=>({...m,canChangeAccess:mayMove(auth,m),accessVersion:m.access_version||m.id}))});
 }catch{return reply(503,{error:'The files for this page could not be safely verified or changed. No other unit or page was substituted.'});}
};}
export const handler=createUnitFilesHandler();
