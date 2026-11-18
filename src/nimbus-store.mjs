import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import policy from './policy.cjs';

export async function qbRequest(path,body,fetcher=fetch){
 const token=process.env.NIMBUS_QB_TOKEN;if(!token)throw Error('Nimbus storage is not configured.');
 const response=await fetcher('https://api.quickbase.com/v1/'+path,{method:'POST',headers:{'QB-Realm-Hostname':'mit.quickbase.com',Authorization:'QB-USER-TOKEN '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Object.assign(Error('Nimbus storage request failed.'),{code:'QB_HTTP_'+response.status});
 const result=await response.json();if(result.metadata?.lineErrors&&Object.keys(result.metadata.lineErrors).length)throw Object.assign(Error('Nimbus storage rejected records.'),{code:'QB_RECORD_REJECTED'});return result;
}
export function encryptionKey(){
 if(!process.env.NIMBUS_DATA_KEY)throw Error('Nimbus encryption is not configured.');
 return Buffer.from(hkdfSync('sha256',process.env.NIMBUS_DATA_KEY,'MITSOEServices Nimbus '+policy.deploymentName(),'saved-snapshot-v1',32));
}
export function seal(value,key,aad){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(aad));return [iv,c.update(JSON.stringify(value),'utf8'),c.final(),c.getAuthTag()].map(b=>b.toString('base64')).join('.');}
export function unseal(value,key,aad){const parts=String(value).split('.');if(parts.length!==4)throw Error('Invalid encrypted snapshot');const [iv,body,end,tag]=parts.map(v=>Buffer.from(v,'base64'));const c=createDecipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(aad));c.setAuthTag(tag);return JSON.parse(Buffer.concat([c.update(Buffer.concat([body,end])),c.final()]).toString('utf8'));}
export function sealCompressed(value,key,aad){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));const encrypted=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(value)))),cipher.final()]);return 'gz1.'+[iv,encrypted,cipher.getAuthTag()].map(v=>v.toString('base64')).join('.');}
export function unsealCompressed(value,key,aad){const parts=String(value).split('.');if(parts.length!==4||parts[0]!=='gz1')throw Error('Invalid compressed snapshot.');const [iv,body,tag]=parts.slice(1).map(v=>Buffer.from(v,'base64')),decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(tag);return JSON.parse(gunzipSync(Buffer.concat([decipher.update(body),decipher.final()]),{maxOutputLength:8*1024*1024}).toString('utf8'));}
export function createSnapshotRepository({table=process.env.NIMBUS_SNAPSHOTS_TABLE,query=qbRequest,key=encryptionKey}={}){
 const checked=()=>{if(!/^b[a-z0-9]+$/.test(table||''))throw Error('Nimbus storage is not configured.');};
 return {
  async put(scope,id,value){checked();const cipher=seal(value,key(),scope+':'+id);const r=await query('records',{to:table,mergeFieldId:6,data:[{'6':{value:id},'7':{value:scope},'8':{value:cipher}}],fieldsToReturn:[3]});if(r.data?.length!==1)throw Error('Snapshot was not saved.');},
  async putCompressed(scope,id,value){checked();const cipher=sealCompressed(value,key(),scope+':'+id);const r=await query('records',{to:table,mergeFieldId:6,data:[{'6':{value:id},'7':{value:scope},'8':{value:cipher}}],fieldsToReturn:[3]});if(r.data?.length!==1)throw Error('Snapshot was not saved.');},
  async get(scope,id){checked();if(!/^[a-z0-9:_-]+$/.test(id))throw Error('Invalid snapshot ID');const r=await query('records/query',{from:table,select:[6,7,8],where:`{6.EX.'${id}'}AND{7.EX.'${scope}'}`,options:{top:2}});if(!Array.isArray(r.data)||r.data.length!==1||r.metadata?.totalRecords!==1)throw Error('Snapshot record is missing or ambiguous.');const row=r.data[0];if(row['6']?.value!==id||row['7']?.value!==scope)throw Error('Snapshot scope mismatch.');const value=row['8']?.value;return String(value).startsWith('gz1.')?unsealCompressed(value,key(),scope+':'+id):unseal(value,key(),scope+':'+id);}
 };
}
export async function pointerStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'mitsoeservices-nimbus-'+policy.deploymentName(),consistency:'strong'});}
export async function unitAccounts(scope){
 const units=(await import('./units.cjs')).default;
 if(scope==='school')return null;
 const {readUnit,validPayload}=await import('./unit-data.mjs');
 const keys=new Set();
 for(const resource of units.walletsForUnit(scope)){
  const data=await readUnit(resource);if(!validPayload(data,resource))throw Error('The trusted unit account list is unavailable.');
  for(const row of data.rows){const account=String(row.account??'').trim();if(/^\d{7}$/.test(account))keys.add(account);}
 }
 if(!keys.size)throw Error('The trusted unit account list is unavailable.');return [...keys];
}
