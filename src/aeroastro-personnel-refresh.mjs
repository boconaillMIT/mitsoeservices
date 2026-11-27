import {createHash,createHmac,hkdfSync,randomUUID,timingSafeEqual} from 'node:crypto';
import {preparePersonnelRefresh,appointmentKey} from '../public/aeroastro-personnel-refresh-model.mjs';
import {MAX_REPORT_BYTES} from '../public/aeroastro-refresh-model.mjs';
import {encryptionKey} from './nimbus-store.mjs';import {validateFinanceSource} from './aeroastro-finance-source.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function personnelIdentityKey(key){return Buffer.from(hkdfSync('sha256',key,Buffer.from('aeroastro-person-identity-v1'),Buffer.from('private-notebook-stable-person'),32));}
export const stablePersonKey=(key,id)=>createHmac('sha256',key).update(id).digest('hex');
// The original local identity preparation used the default (preview-salted) root.
// This derives that historical identity key only; storage always remains production-scoped.
export function legacyIdentityRoot(){if(!process.env.NIMBUS_DATA_KEY)throw Error('Identity key unavailable');return Buffer.from(hkdfSync('sha256',process.env.NIMBUS_DATA_KEY,'MITSOEServices Nimbus preview','saved-snapshot-v1',32));}
export function matchingIdentityKey(rows,keys,root,legacyRoot=legacyIdentityRoot){
 if(keys.size!==rows.length)throw Error('Incomplete identities');
 for(const provider of [root,legacyRoot]){const base=Buffer.from(provider()),derived=personnelIdentityKey(base);base.fill(0);if(rows.every(r=>/^\d{9}$/.test(r.employeeId||'')&&keys.get(r.id)===stablePersonKey(derived,r.employeeId)))return derived;derived.fill(0);}
 throw Error('Existing identity key does not match');
}
export function createPersonnelRefreshHandler({key=encryptionKey,legacyRoot=legacyIdentityRoot,now=()=>new Date(),uuid=randomUUID}={}){
 const sign=(actor,version,csv,asOf,issued)=>createHmac('sha256',key()).update(JSON.stringify(['aeroastro-personnel-refresh-v1',actor,version,hash(csv),asOf,issued])).digest('hex');
 return async(event,auth,repo)=>{
  const reply=(status,body)=>({statusCode:status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie'},body:JSON.stringify(body)}),headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!auth.canWrite)return reply(403,{error:'Personnel refresh requires AeroAstro finance write access.'});if(event.httpMethod!=='POST')return reply(405,{error:'POST required.'});
  if(!process.env.APP_ORIGIN||headers.origin!==process.env.APP_ORIGIN||headers['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
  if(typeof event.body!=='string'||event.body.length>MAX_REPORT_BYTES+100000)return reply(413,{error:'Choose a roster smaller than 2 MB.'});
  let b;try{b=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid personnel refresh request.'});}
  if(!b||Object.keys(b).some(k=>!['csv','asOf','operation','issued','confirmation','acknowledgeMissing'].includes(k))||typeof b.csv!=='string'||!['preview','commit'].includes(b.operation))return reply(400,{error:'Invalid personnel refresh request.'});
  let identityKey;
  try{
   const raw=await repo.snapshot('people'),current=await repo.peopleDetails(raw);if(!current?.sourceHash)return reply(503,{error:'The verified roster is unavailable. Try again later.'});
   if(b.asOf>now().toISOString().slice(0,10))return reply(400,{error:'The report date cannot be in the future.'});
   let prepared;try{prepared=preparePersonnelRefresh(b.csv,current,b.asOf);}catch(e){return reply(400,{error:e.message});}
   const keys=await repo.personKeys(raw);try{identityKey=matchingIdentityKey(current.rows,keys,key,legacyRoot);}catch{return reply(503,{error:'Private-note identities could not be verified. Nothing has been changed. Ask the site administrator to check the roster mapping.'});}
   const version=hash(JSON.stringify([raw.sourceHash,raw.publishedAt,raw.asOf,current.rows]));
   if(b.operation==='preview'){const issued=now().toISOString();return reply(200,{summary:prepared.summary,changes:prepared.changes,issued,confirmation:sign(auth.kerberos,version,b.csv,b.asOf,issued)});}
   if(typeof b.confirmation!=='string'||!/^[a-f0-9]{64}$/.test(b.confirmation)||!Number.isFinite(Date.parse(b.issued))||+now()-Date.parse(b.issued)>600000||Date.parse(b.issued)>+now())return reply(409,{error:'Preview this roster again before saving.'});
   if(!timingSafeEqual(Buffer.from(sign(auth.kerberos,version,b.csv,b.asOf,b.issued),'hex'),Buffer.from(b.confirmation,'hex')))return reply(409,{error:'The file or saved roster changed. Preview again before saving.'});
   if(prepared.summary.missing&&b.acknowledgeMissing!==true)return reply(400,{error:'Confirm that you reviewed the appointments missing from the latest roster.'});
   const oldKeys=new Set(current.rows.map(r=>appointmentKey(r))),rows=prepared.rows.map(r=>({...r,id:oldKeys.has(appointmentKey(r))?r.id:'appointment-'+createHmac('sha256',identityKey).update('appointment-v1:'+appointmentKey(r)).digest('hex')}));
   const sourceHash=hash(b.csv),identities={schema:1,unit:'aeroastro',sourceHash,rows:rows.map(r=>({appointmentId:r.id,personKey:stablePersonKey(identityKey,r.employeeId)}))};
   const candidate=validateFinanceSource({schema:1,unit:'aeroastro',kind:'people',asOf:b.asOf,label:'MIT Reports HR roster · uploaded by '+auth.kerberos+'@mit.edu',sourceHash,publishedAt:now().toISOString(),publishedBy:auth.kerberos,importId:uuid(),rosterFormat:'complete-v2',personIdentities:identities,rows},'people',now());
   const result=await repo.refreshPeople(raw,candidate);if(result.conflict)return reply(409,{error:'Another roster update was saved first. Preview again before saving.'});
   return reply(200,{saved:true,summary:prepared.summary,publishedBy:candidate.publishedBy,publishedAt:candidate.publishedAt});
  }catch{return reply(503,{error:'The roster refresh could not be confirmed. Reload to check the source before retrying. Existing notes and permissions are preserved.'});}finally{identityKey?.fill(0);}
 };
}
