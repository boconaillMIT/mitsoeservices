import {hkdfSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import access from './access.cjs';
import policy from './policy.cjs';
import {seal,unseal} from './nimbus-store.mjs';
import {inventoryWorker} from './inventory-worker.mjs';
export const PILOT_UNITS=Object.freeze(['aeroastro','soe-fake']);
const FIELDS=['account','name','fundCenter','profitCenter','control','closed'];
export function normalizeAccounts(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>20000)throw Error('Choose a report containing between 1 and 20,000 account rows.');
 const accounts=new Map();
 for(const row of rows){
  if(!row||Array.isArray(row)||Object.keys(row).some(k=>!FIELDS.includes(k))||!/^\d{7}$/.test(row.account||''))throw Error('Use seven-digit account numbers and account metadata only.');
  const clean={};
  for(const k of FIELDS){if(row[k]!==undefined&&(typeof row[k]!=='string'||row[k].length>240||/[\x00-\x1f\x7f]/.test(row[k])))throw Error('Invalid account metadata.');clean[k]=(row[k]||'').trim();}
  if(!clean.name)throw Error('Each account needs its name.');
  const old=accounts.get(clean.account);
  if(old&&JSON.stringify(old)!==JSON.stringify(clean))throw Error('An account has conflicting names or center details. Review the source export.');
  accounts.set(clean.account,clean);
 }
 return [...accounts.values()].sort((a,b)=>a.fundCenter.localeCompare(b.fundCenter)||a.account.localeCompare(b.account));
}
export function inventoryKey(){
 if(!process.env.UNIT_FILES_DATA_KEY||process.env.UNIT_FILES_DATA_KEY.length<32)throw Error('Inventory encryption unavailable.');
 return Buffer.from(hkdfSync('sha256',process.env.UNIT_FILES_DATA_KEY,'MITSOEServices account inventory '+policy.deploymentName(),'inventory-v1',32));
}
export async function inventoryStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'mitsoeservices-account-inventory-'+policy.deploymentName(),consistency:'strong'});}
const binding=k=>'unit-account-inventory-v1:'+policy.deploymentName()+':'+k;
function decode(entry,k,key,scope,owner){
 if(!entry)return null;
 if(!entry.etag||typeof entry.data?.cipher!=='string')throw Error('Inventory unavailable.');
 const v=unseal(entry.data.cipher,key(),binding(k));
 if(v.schema!==1||v.unit!==scope||owner&&v.owner!==owner||!Array.isArray(v.accounts))throw Error('Inventory scope mismatch.');
 normalizeAccounts(v.accounts);return v;
}
export function createInventoryHandler({authorize=access.authorize,store=inventoryStore,key=inventoryKey,worker=inventoryWorker,now=()=>new Date()}={}){return async event=>{
 const reply=(status,data)=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'GET or POST required.'});
 const unit=event.queryStringParameters?.unit;
 if(!PILOT_UNITS.includes(unit))return reply(404,{error:'Account-list pilot not available for this unit.'});
 const auth=await authorize(event,{scope:unit,minimum:'admin'});if(!auth.user)return auth;
 if(event.httpMethod==='GET'&&event.queryStringParameters?.action==='source-query'){
  return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename=unit-account-inventory.sql'},body:await readFile(join(process.cwd(),'src/account-inventory-query.sql'),'utf8')};
 }
 const draftKey='draft:'+unit+':'+auth.kerberos,reviewedKey='reviewed:'+unit;
 if(event.httpMethod==='POST'){
  const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!process.env.APP_ORIGIN||h.origin!==process.env.APP_ORIGIN||h['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
  if(typeof event.body!=='string'||event.body.length>4500000)return reply(413,{error:'Account list is too large.'});
 }
 try{
  const s=await store();
  const load=async()=>{
   const [d,r]=await Promise.all([s.getWithMetadata(draftKey,{type:'json'}),s.getWithMetadata(reviewedKey,{type:'json'})]);
   return {draft:decode(d,draftKey,key,unit,auth.kerberos),draftVersion:d?.etag||null,reviewed:decode(r,reviewedKey,key,unit),reviewedVersion:r?.etag||null};
  };
  if(event.httpMethod==='GET'&&event.queryStringParameters?.action==='worker-status')return reply(200,{unit,worker:await worker('status',auth.kerberos,unit)});
  if(event.httpMethod==='GET')return reply(200,{unit,...await load()});
  let body,workerSource=false;try{body=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid JSON.'});}
  if(['run-worker','use-worker'].includes(body?.action)){
   if(Object.keys(body).some(k=>k!=='action'))return reply(400,{error:'Invalid worker request.'});
   if(body.action==='run-worker')return reply(200,{unit,...await worker('run',auth.kerberos,unit)});
   const saved=await worker('read',auth.kerberos,unit);workerSource=true;body={action:'draft',accounts:saved.accounts,filename:'Warehouse account inventory — '+saved.published_at,sha256:saved.sha256,ownCredentials:true};
  }
  if(body?.action==='draft'){
   if(Object.keys(body).some(k=>!['action','accounts','filename','sha256','ownCredentials'].includes(k))||body.ownCredentials!==true||typeof body.filename!=='string'||body.filename.length>180||! /^[a-f0-9]{64}$/.test(body.sha256||''))return reply(400,{error:'Confirm that you ran this extract with your own Warehouse credentials.'});
   const accounts=normalizeAccounts(body.accounts),old=await s.getWithMetadata(draftKey,{type:'json'});
   const value={schema:1,unit,owner:auth.kerberos,created_at:now().toISOString(),filename:body.filename,sha256:body.sha256,provenance:workerSource?'Existing owner-bound worker; query signature and encrypted output verified':'uploader-attested; not independently verified',accounts};
   const saved=await s.setJSON(draftKey,{cipher:seal(value,key(),binding(draftKey))},old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
   if(!saved.modified)return reply(409,{error:'Your draft changed. Reload before uploading again.'});
   return reply(201,{unit,...await load()});
  }
  if(body?.action==='review'){
   if(Object.keys(body).some(k=>!['action','selected','draftVersion','reviewedVersion','confirmed'].includes(k))||body.confirmed!==true||!Array.isArray(body.selected)||!body.selected.length||new Set(body.selected).size!==body.selected.length)return reply(400,{error:'Select the unit accounts and confirm your review.'});
   const current=await load();
   if(!current.draft||current.draftVersion!==body.draftVersion||current.reviewedVersion!==body.reviewedVersion)return reply(409,{error:'The draft or reviewed list changed. Reload and review again.'});
   const source=new Map(current.draft.accounts.map(a=>[a.account,a]));
   if(body.selected.some(a=>typeof a!=='string'||!source.has(a)))return reply(400,{error:'Only accounts from your own current draft can be selected.'});
   const previous=current.reviewed;
   const value={schema:1,unit,reviewed_by:auth.kerberos,reviewed_at:now().toISOString(),source_owner:current.draft.owner,source_sha256:current.draft.sha256,provenance:current.draft.provenance,purpose:'Reviewed account inventory only; not a publication permission or Nimbus allowlist.',accounts:body.selected.map(a=>source.get(a)),history:[...(previous?.history||[]),...(previous?[{at:previous.reviewed_at,by:previous.reviewed_by,count:previous.accounts.length}]:[])].slice(-20)};
   const saved=await s.setJSON(reviewedKey,{cipher:seal(value,key(),binding(reviewedKey))},current.reviewedVersion?{onlyIfMatch:current.reviewedVersion}:{onlyIfNew:true});
   if(!saved.modified)return reply(409,{error:'Another administrator saved a newer list. Reload before trying again.'});
   return reply(200,{unit,...await load()});
  }
  return reply(400,{error:'Unknown inventory action.'});
 }catch(error){return reply(400,{error:/seven-digit|metadata|account needs|conflicting|between 1 and/.test(error.message)?error.message:'The account list could not be safely loaded or saved. No report or permissions were changed.'});}
};}
export const handler=createInventoryHandler();
