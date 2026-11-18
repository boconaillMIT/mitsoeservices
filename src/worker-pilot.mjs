import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import access from './access.cjs';
import {createJobDispatcher,readTabularResult} from './worker-jobs.mjs';
import policy from './policy.cjs';
import {normalizeReport} from './published-report.mjs';
export const PILOT_OWNER='oconaill';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function pilotStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'mitsoeservices-worker-pilot-'+policy.deploymentName(),consistency:'strong'});}
export function createWorkerPilotHandler({authorize=access.authorize,store=pilotStore,loadPolicy=policy.loadPolicy,now=()=>new Date(),dispatch=createJobDispatcher(),readTabular=readTabularResult,random=()=>randomBytes(32).toString('base64url')}={}){return async event=>{
 const reply=(status,data)=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'GET or POST required.'});
 const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
 if(headers.authorization){
  // Device tokens are upload-only: no policy reads, arbitrary queries, or production publication.
  if(event.httpMethod!=='POST')return reply(403,{error:'Device upload only.'});
  const token=/^Bearer (wkp_[a-f0-9]{24}\.[A-Za-z0-9_-]{43})$/.exec(headers.authorization)?.[1];
  if(!token)return reply(401,{error:'Invalid worker authorization.'});
  try{
   const s=await store(),device=await s.get('device:'+token.split('.')[0],{type:'json'});
   const current=await loadPolicy();
   if(!device||device.owner!==PILOT_OWNER||device.revoked||Date.parse(device.expires_at)<=now().getTime()||policy.effectiveRole(current.data,PILOT_OWNER,'school')!=='admin'||typeof device.hash!=='string'||device.hash.length!==64||!timingSafeEqual(Buffer.from(device.hash),Buffer.from(hash(token))))return reply(403,{error:'This worker is expired, revoked, or no longer authorized.'});
   if(headers['content-type']?.split(';')[0]!=='application/json'||typeof event.body!=='string'||event.body.length>4500000)return reply(400,{error:'Invalid report upload.'});
   let parsed;try{parsed=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid worker message.'});}
   if(parsed?.protocol==='catalog-v2'){const response=await dispatch({body:parsed,device,store:s});return reply(response.status,response.data);}
   let result;try{result=normalizeReport(parsed);}catch{return reply(400,{error:'The report could not be validated.'});}
   const previous=await s.getWithMetadata('latest:'+PILOT_OWNER,{type:'json'});
   if(previous&&Date.parse(result.retrieved)<=Date.parse(previous.data.result.retrieved))return reply(409,{error:'A newer pilot report is already saved.'});
   const value={schema:1,published_by:PILOT_OWNER,device:device.id,published_at:now().toISOString(),result};
   const saved=await s.setJSON('latest:'+PILOT_OWNER,value,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
   return saved.modified?reply(200,{saved:true,accounts:result.rows.length,published_at:value.published_at}):reply(409,{error:'Another worker saved a newer report.'});
  }catch(error){return reply(503,{error:'Pilot upload failed. The previous saved report remains available.',code:/^[A-Z][A-Z0-9_]{0,39}$/.test(error?.code||'')?error.code:'WORKER_CONTROLLER_UNAVAILABLE'});}
 }
 const auth=await authorize(event,{scope:'school',minimum:'admin'});if(!auth.user)return auth;
 if(auth.kerberos!==PILOT_OWNER)return reply(403,{error:'This pilot is available only to Brian (oconaill).'});
 try{
  const s=await store();
  if(event.httpMethod==='GET'){
   if(event.queryStringParameters?.action==='tabular'){const result=await readTabular(s,PILOT_OWNER,event.queryStringParameters.report,Number(event.queryStringParameters.page||1));return result?reply(200,result):reply(404,{error:'No saved output for this report.'});}
   const devices=await s.get('devices:'+PILOT_OWNER,{type:'json'})||[];
   const rows=await Promise.all(devices.map(id=>s.get('device:'+id,{type:'json'})));
   const latest=await s.get('latest:'+PILOT_OWNER,{type:'json'});
   return reply(200,{devices:rows.filter(Boolean).map(({id,label,created_at,expires_at,revoked})=>({id,label,created_at,expires_at,revoked})),latest});
  }
  if(!process.env.APP_ORIGIN||headers.origin!==process.env.APP_ORIGIN||headers['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
  let body;try{body=JSON.parse(event.body||'');}catch{return reply(400,{error:'Invalid JSON.'});}
  if(body.action==='create'){
   const listing=await s.getWithMetadata('devices:'+PILOT_OWNER,{type:'json'}),ids=listing?.data||[];
   if(ids.length>=20)return reply(400,{error:'Pilot device limit reached.'});
   const id='wkp_'+randomBytes(12).toString('hex'),token=id+'.'+random(),record={id,owner:PILOT_OWNER,scope:'school-pilot-only',hash:hash(token),label:String(body.label||'Brian’s pilot PC').slice(0,100),created_at:now().toISOString(),expires_at:new Date(now().getTime()+90*86400000).toISOString(),revoked:false};
   await s.setJSON('device:'+id,record,{onlyIfNew:true});
   const updated=await s.setJSON('devices:'+PILOT_OWNER,[...ids,id],listing?{onlyIfMatch:listing.etag}:{onlyIfNew:true});
   if(!updated.modified){await s.setJSON('device:'+id,{...record,revoked:true});return reply(409,{error:'Device list changed. Retry.'});}
   return reply(200,{token,expires_at:record.expires_at});
  }
  if(body.action==='revoke'&&/^wkp_[a-f0-9]{24}$/.test(body.id||'')){
   const key='device:'+body.id,record=await s.getWithMetadata(key,{type:'json'});if(!record||record.data.owner!==PILOT_OWNER)return reply(404,{error:'Device not found.'});
   const updated=await s.setJSON(key,{...record.data,revoked:true},{onlyIfMatch:record.etag});return reply(updated.modified?200:409,{revoked:updated.modified});
  }
  return reply(400,{error:'Unknown action.'});
 }catch{return reply(503,{error:'Pilot management is temporarily unavailable.'});}
};}
export const handler=createWorkerPilotHandler();
