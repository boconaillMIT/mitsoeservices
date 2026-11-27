import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {prepareAccountRefresh,MAX_REPORT_BYTES} from '../public/aeroastro-refresh-model.mjs';
import {encryptionKey} from './nimbus-store.mjs';
import {validateFinanceSource} from './aeroastro-finance-source.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function createAccountRefreshHandler({key=encryptionKey,now=()=>new Date(),uuid=randomUUID}={}){
 const sign=(actor,source,csv,asOf,issued)=>createHmac('sha256',key()).update(JSON.stringify(['aeroastro-account-refresh-v1',actor,source,hash(csv),asOf,issued])).digest('hex');
 return async(event,auth,repo)=>{
  const reply=(status,body)=>({statusCode:status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie'},body:JSON.stringify(body)});
  const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!auth.canWrite)return reply(403,{error:'Account refresh requires AeroAstro finance write access.'});
  if(event.httpMethod!=='POST')return reply(405,{error:'POST required.'});
  if(!process.env.APP_ORIGIN||headers.origin!==process.env.APP_ORIGIN||headers['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
  if(typeof event.body!=='string'||event.body.length>MAX_REPORT_BYTES+100000)return reply(413,{error:'Choose a report smaller than 2 MB.'});
  let b;try{b=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid refresh request.'});}
  if(!b||Object.keys(b).some(k=>!['csv','asOf','operation','issued','confirmation'].includes(k))||typeof b.csv!=='string'||!['preview','commit'].includes(b.operation))return reply(400,{error:'Invalid refresh request.'});
  try{
   const current=await repo.snapshot('accounts');if(!current?.sourceHash)return reply(503,{error:'The verified account inventory is unavailable. Try again later.'});
   if(b.asOf>now().toISOString().slice(0,10))return reply(400,{error:'The report date cannot be in the future.'});
   const version=hash(JSON.stringify([current.sourceHash,current.publishedAt,current.asOf]));
   let prepared;try{prepared=prepareAccountRefresh(b.csv,current,b.asOf);}catch(e){return reply(400,{error:e.message});}
   if(b.operation==='preview'){const issued=now().toISOString();return reply(200,{summary:prepared.summary,asOf:b.asOf,issued,confirmation:sign(auth.kerberos,version,b.csv,b.asOf,issued)});}
   if(typeof b.confirmation!=='string'||! /^[a-f0-9]{64}$/.test(b.confirmation)||!Number.isFinite(Date.parse(b.issued))||+now()-Date.parse(b.issued)>10*60*1000||Date.parse(b.issued)>+now())return reply(409,{error:'Preview this report again before saving.'});
   const expected=sign(auth.kerberos,version,b.csv,b.asOf,b.issued);
   if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(b.confirmation,'hex')))return reply(409,{error:'The report or saved data changed. Preview again before saving.'});
   const candidate=validateFinanceSource({schema:1,unit:'aeroastro',kind:'accounts',asOf:b.asOf,label:'MIT Reports CSV · uploaded by '+auth.kerberos+'@mit.edu',sourceHash:hash(b.csv),publishedAt:now().toISOString(),publishedBy:auth.kerberos,importId:uuid(),rows:prepared.rows},'accounts',now());
   const saved=await repo.refreshAccounts(current,candidate);if(saved.conflict)return reply(409,{error:'Another refresh was saved first. Preview again before saving.'});
   return reply(200,{saved:true,summary:prepared.summary,asOf:candidate.asOf,publishedAt:candidate.publishedAt,publishedBy:candidate.publishedBy});
  }catch{return reply(503,{error:'The refresh could not be confirmed. Reload to check the current source before retrying. Your notes are preserved.'});}
 };
}
