import access from './access.cjs';
import policy from './policy.cjs';
export async function reportStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'mitsoeservices-reports-'+policy.deploymentName(),consistency:'strong'});}
const number=v=>v===null||((typeof v==='string'||typeof v==='number')&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Math.abs(Number(v))<=1e15);
export function normalizeReport(input){
 if(input?.view!=='all'||!/^2027(0[1-9]|1[0-6])$/.test(input.period)||!Number.isFinite(Date.parse(input.retrieved))||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>20000)throw Error('A complete all-account report is required.');
 const keys=new Set(),rows=input.rows.map(row=>{
  if(typeof row.key!=='string'||!(/^[0-9]{7}$/.test(row.key)||/^Invalid cost object \(QB record [0-9]+\)$/.test(row.key))||keys.has(row.key)||typeof row.deans_discretionary!=='boolean')throw Error('Run a fresh all-account report with the updated worker before publishing.');
  keys.add(row.key);const out={key:row.key,deans_discretionary:row.deans_discretionary};
  for(const key of ['balance','projected','estimate','after','actual']){if(!number(row[key]))throw Error('Invalid report amount.');out[key]=row[key];}
  for(const key of ['name','category'])out[key]=String(row[key]||'').slice(0,2000);
  out.issues=Array.isArray(row.issues)?row.issues.slice(0,100).map(v=>String(v).slice(0,2000)):[];
  out.details=Array.isArray(row.details)?row.details.slice(0,2000).map(d=>({payment:String(d.payment||'').slice(0,100),commitment:String(d.commitment||'').slice(0,1000),status:String(d.status||'').slice(0,100),amount:number(d.amount)?d.amount:null})):[];
  return out;
 });
 return {view:'all',period:input.period,retrieved:input.retrieved,include_pending:input.include_pending===true,proration:input.proration?{as_of:String(input.proration.as_of||''),remaining_days:Number(input.proration.remaining_days),fiscal_year_days:Number(input.proration.fiscal_year_days)}:null,rows,issues:Array.isArray(input.issues)?input.issues.slice(0,5000).map(v=>String(v).slice(0,2000)):[]};
}
export function createPublishedHandler({authorize=access.authorize,store=reportStore}={}){return async event=>{
 if(!['GET','POST'].includes(event.httpMethod))return {statusCode:405,headers:access.noStore,body:'GET or POST required.'};
 const auth=await authorize(event,{scope:'school',minimum:event.httpMethod==='POST'?'admin':'read'});if(!auth.user)return auth;
 const reply=(status,data)=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(event.httpMethod==='POST'){
  const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!process.env.APP_ORIGIN||headers.origin!==process.env.APP_ORIGIN||headers['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
  if(typeof event.body!=='string'||event.body.length>4500000)return reply(413,{error:'Report is too large.'});
  let result;try{result=normalizeReport(JSON.parse(event.body));}catch(e){return reply(400,{error:e.message});}
  try{const s=await store(),previous=await s.getWithMetadata('latest',{type:'json'});
   if(previous&&Date.parse(result.retrieved)<Date.parse(previous.data.result.retrieved))return reply(409,{error:'A newer report has already been published. Refresh before publishing.'});
   const payload={schema:1,published_at:new Date().toISOString(),published_by:auth.kerberos,result};
   const saved=await s.setJSON('latest',payload,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
   if(!saved.modified)return reply(409,{error:'Another administrator published a report. Reload before trying again.'});
   return reply(200,{published_at:payload.published_at,accounts:result.rows.length});
  }catch{return reply(503,{error:'Publishing failed. The previous published report is still available.'});}
 }
 try{const saved=await (await store()).get('latest',{type:'json'});if(!saved)return reply(404,{error:'No account report has been published yet.'});normalizeReport(saved.result);return reply(200,saved);}catch{return reply(503,{error:'The published report is temporarily unavailable.'});}
};}
export const handler=createPublishedHandler();
