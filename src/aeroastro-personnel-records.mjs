import {createHash,randomUUID} from 'node:crypto';
import {validateFinanceSource} from './aeroastro-finance-source.mjs';
export const personnelVersion=source=>createHash('sha256').update(JSON.stringify(source)).digest('hex');
export function createPersonnelRecordsHandler({now=()=>new Date(),uuid=randomUUID}={}){return async(event,auth,repo)=>{
 const reply=(statusCode,value)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store',Vary:'Cookie'},body:JSON.stringify(value)});
 if(!auth.canWrite)return reply(403,{error:'AeroAstro finance write access is required.'});
 if(event.httpMethod!=='POST')return reply(405,{error:'POST required.'});
 const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
 if(!process.env.APP_ORIGIN||headers.origin!==process.env.APP_ORIGIN||headers['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
 if(typeof event.body!=='string'||event.body.length>2000)return reply(400,{error:'Invalid roster action.'});
 let b;try{b=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid roster action.'});}
 if(!b||Object.keys(b).some(k=>!['operation','id','version'].includes(k))||!['delete','restore'].includes(b.operation)||typeof b.id!=='string'||!b.id||b.id.length>100||!/^[a-f0-9]{64}$/.test(b.version||''))return reply(400,{error:'Invalid roster action.'});
 try{
  const raw=await repo.snapshot('people');if(!raw)return reply(503,{error:'The roster is unavailable.'});
  if(personnelVersion(raw)!==b.version)return reply(409,{error:'The roster changed. Reload and review this record before trying again.'});
  const current=await repo.peopleDetails(raw),row=current.rows.find(r=>r.id===b.id);
  if(!row)return reply(404,{error:'Record not found in AeroAstro.'});
  if(row.inCurrentRoster!==false)return reply(409,{error:'Records on the latest roster cannot be deleted.'});
  if(Boolean(row.deletedAt)!==(b.operation==='restore'))return reply(409,{error:'This record has already changed. Reload before trying again.'});
  const identities=await repo.personKeys(raw);if(identities.size!==current.rows.length||current.rows.some(r=>!identities.has(r.id)))throw Error('Incomplete identities');
  const rows=current.rows.map(r=>{if(r.id!==b.id)return r;const next={...r};if(b.operation==='delete'){next.deletedAt=now().toISOString();next.deletedBy=auth.kerberos;}else{delete next.deletedAt;delete next.deletedBy;}return next;});
  const candidate=validateFinanceSource({...current,rows,rosterFormat:'complete-v2',personIdentities:{schema:1,unit:'aeroastro',sourceHash:current.sourceHash,rows:rows.map(r=>({appointmentId:r.id,personKey:identities.get(r.id)}))},publishedBy:auth.kerberos,publishedAt:now().toISOString(),importId:uuid()},'people',now());
  const result=await repo.refreshPeople(raw,candidate);if(result.conflict)return reply(409,{error:'Another roster change was saved first. Reload before trying again.'});
  return reply(200,{saved:true,operation:b.operation});
 }catch{return reply(503,{error:'The change could not be confirmed. Reload to check before retrying. Private notes are preserved.'});}
};}
