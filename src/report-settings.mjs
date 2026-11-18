import access from './access.cjs';
import policy from './policy.cjs';
const DEFAULT_CATALOGUE={schema:1,reports:[
 {id:'balances',name:'Account balances & FY27 outlook',description:'Current balances, commitments, and balances after projections.',duration:'A few minutes',minimumRole:'admin',savedUrl:'/reports?view=all',runner:'soe-account-outlook-v1'},
 {id:'nimbus',name:'Nimbus transaction history',description:'Searchable budget transaction history across fiscal years.',duration:'About 20 minutes',minimumRole:'admin',savedUrl:'/nimbus',runner:'nimbus-v1'}
]};
export async function settingsStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'mitsoeservices-report-settings-'+policy.deploymentName(),consistency:'strong'});}
export function defaults(reports){return {timezone:'America/New_York',catchup:true,paused:false,reports:Object.fromEntries(reports.map(r=>[r.id,{enabled:false,frequency:r.id==='nimbus'?'weekly':'daily',day:r.id==='nimbus'?'5':'1',time:r.id==='nimbus'?'09:30':'09:00'}]))};}
export function validatePreferences(input,reports){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['timezone','catchup','paused','reports'].includes(k))||typeof input.timezone!=='string'||input.timezone.length>80||typeof input.catchup!=='boolean'||typeof input.paused!=='boolean'||!input.reports||typeof input.reports!=='object'||Array.isArray(input.reports))throw Error('Invalid preferences.');
 try{new Intl.DateTimeFormat('en-US',{timeZone:input.timezone});}catch{throw Error('Choose a valid time zone.');}
 const allowed=new Set(reports.map(r=>r.id));
 if(Object.keys(input.reports).some(id=>!allowed.has(id)))throw Error('One or more reports are not available to your account.');
 const out={timezone:input.timezone,catchup:input.catchup,paused:input.paused,reports:{}};
 for(const report of reports){const r=input.reports[report.id];if(!r||Object.keys(r).some(k=>!['enabled','frequency','day','time'].includes(k))||typeof r.enabled!=='boolean'||!['daily','weekdays','weekly','monthly'].includes(r.frequency)||typeof r.day!=='string'||!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(r.time||''))throw Error('Choose a valid report schedule.');
  if(r.frequency==='weekly'&&!/^[0-6]$/.test(r.day)||r.frequency==='monthly'&&!(/^(?:[1-9]|1\d|2[0-8])$/.test(r.day)||r.day==='last'))throw Error('Choose a valid schedule day.');
  out.reports[report.id]={enabled:r.enabled,frequency:r.frequency,day:r.day,time:r.time};
 }
 return out;
}
async function devicesFor(username){
 const {pilotStore}=await import('./worker-pilot.mjs'),s=await pilotStore(),ids=await s.get('devices:'+username,{type:'json'})||[];
 if(!Array.isArray(ids)||ids.length>20)throw Error('Invalid device list.');
 const entries=await Promise.all(ids.map(id=>s.get('device:'+id,{type:'json'})));
 const latest=await s.get('latest:'+username,{type:'json'});
 const history=await s.get('activity:'+username,{type:'json'});
 const active=await s.get('active:'+username,{type:'json'});
 return {devices:entries.filter(d=>d&&d.owner===username).map(d=>({id:d.id,label:d.label,created_at:d.created_at,expires_at:d.expires_at,revoked:!!d.revoked,compatible:['2.0.0','2.0.1','2.0.2','2.0.3','2.0.4'].includes(d.worker_version)&&Array.isArray(d.capabilities),worker_version:d.worker_version||'1.0',capabilities:d.capabilities||[],last_seen:d.last_seen||null,source_available:typeof d.source_available==='boolean'?d.source_available:null})),activeJob:active?.owner===username&&active.status==='running'?{name:active.name,started_at:active.started_at}:null,activity:Array.isArray(history)&&history.length?history:latest&&latest.published_by===username?[{report:'Account balances & FY27 outlook',at:latest.published_at,status:'Pilot upload saved',device:latest.device}]:[]};
}
export function createSettingsHandler({authorize=access.authorize,store=settingsStore,devices=devicesFor,now=()=>new Date()}={}){return async event=>{
 const reply=(status,data)=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'GET or POST required.'});
 const auth=await authorize(event,{scope:'school'});if(!auth.user)return auth;
 try{
  const s=await store();let catalogue=await s.get('catalogue',{type:'json'});
  if(!catalogue){await s.setJSON('catalogue',DEFAULT_CATALOGUE,{onlyIfNew:true});catalogue=await s.get('catalogue',{type:'json'});}
  if(catalogue?.schema!==1||!Array.isArray(catalogue.reports)||catalogue.reports.length>100||catalogue.reports.some(r=>!/^[-a-z0-9]{1,60}$/.test(r.id)||!Object.hasOwn(policy.CAPABILITIES,r.minimumRole)||typeof r.name!=='string'||!(['/reports?view=all','/nimbus'].includes(r.savedUrl)||/^\/worker-pilot\?report=[-a-z0-9]{1,60}$/.test(r.savedUrl)))||new Set(catalogue.reports.map(r=>r.id)).size!==catalogue.reports.length)throw Error('Invalid catalogue.');
  const reports=catalogue.reports.filter(r=>r.enabled!==false&&r.retired!==true&&(!r.owners||Array.isArray(r.owners)&&r.owners.includes(auth.kerberos))&&(policy.CAPABILITIES[auth.role]||0)>=policy.CAPABILITIES[r.minimumRole]);
  const key='preferences:'+auth.kerberos,previous=await s.getWithMetadata(key,{type:'json'}),base=defaults(reports);
  let prefs=base;
  if(previous){if(previous.data.owner!==auth.kerberos)throw Error('Wrong preference owner.');const prior=previous.data.preferences;const visible=Object.fromEntries(reports.map(r=>[r.id,prior.reports?.[r.id]||base.reports[r.id]]));prefs=validatePreferences({...prior,reports:visible},reports);}
  if(event.httpMethod==='POST'){
   const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
   if(!process.env.APP_ORIGIN||headers.origin!==process.env.APP_ORIGIN||headers['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
   if(typeof event.body!=='string'||event.body.length>30000)return reply(413,{error:'Preferences request too large.'});
   let body,next;try{body=JSON.parse(event.body);if(Object.keys(body).some(k=>!['version','preferences'].includes(k)))throw Error('Invalid request.');next=validatePreferences(body.preferences,reports);}catch(e){return reply(400,{error:e.message||'Invalid preferences.'});}
   if(body.version!==(previous?.etag||null))return reply(409,{error:'Your settings changed in another window. Reload before saving.'});
   const value={schema:1,owner:auth.kerberos,updated_at:now().toISOString(),preferences:next};
   const saved=await s.setJSON(key,value,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});if(!saved.modified)return reply(409,{error:'Your settings changed. Reload before saving.'});
   const current=await s.getWithMetadata(key,{type:'json'});return reply(200,{preferences:next,version:current.etag,updated_at:value.updated_at});
  }
  let connected={devices:[],activity:[],available:true};try{connected={...await devices(auth.kerberos),available:true};}catch{connected.available=false;}
  const compatible=connected.devices.some(d=>d.compatible&&!d.revoked&&Date.parse(d.expires_at)>now());
  return reply(200,{scope:'school',owner:auth.kerberos,reports:reports.map(({id,name,description,duration,minimumRole,savedUrl,runner})=>({id,name,description,duration,minimumRole,savedUrl,runner,availableToWorker:connected.devices.some(d=>d.compatible&&!d.revoked&&Date.parse(d.expires_at)>now()&&d.capabilities.includes(runner))})),preferences:prefs,version:previous?.etag||null,updated_at:previous?.data.updated_at||null,schedulingActive:compatible,workerUpgradeRequired:!compatible,canConnectPilot:auth.kerberos==='oconaill'&&auth.admin,...connected});
 }catch{return reply(503,{error:'Settings could not be verified or saved. No preferences were changed.'});}
};}
export const handler=createSettingsHandler();
