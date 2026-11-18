import {randomUUID,createHash,sign,createPrivateKey} from 'node:crypto';
import {settingsStore,defaults,validatePreferences} from './report-settings.mjs';
import {normalizeReport} from './published-report.mjs';
import {seal,unseal,encryptionKey} from './nimbus-store.mjs';
import {checkNimbusPilot,saveNimbusPilotBatch,readNimbusPilotPage} from './nimbus-worker.mjs';
import {validRows} from './nimbus-data.mjs';
const clone=x=>structuredClone(x),hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const RUNNERS=['soe-account-outlook-v1','oracle-tabular-v1'];
const part=(date,zone)=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
function localUtc(y,m,d,h,min,zone){const target=Date.UTC(y,m-1,d,h,min);let estimate=target;for(let i=0;i<3;i++){const p=part(new Date(estimate),zone);estimate+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);}return new Date(estimate);}
export function dueWindow(pref,zone,at,catchup){
 const p=part(at,zone),[h,min]=pref.time.split(':').map(Number);
 for(let offset=0;offset<65;offset++){const day=new Date(Date.UTC(+p.year,+p.month-1,+p.day-offset)),weekday=day.getUTCDay(),last=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+1,0)).getUTCDate();
  if(pref.frequency==='weekly'&&weekday!==+pref.day||pref.frequency==='weekdays'&&(weekday===0||weekday===6)||pref.frequency==='monthly'&&day.getUTCDate()!==(pref.day==='last'?last:+pref.day))continue;
  const due=localUtc(day.getUTCFullYear(),day.getUTCMonth()+1,day.getUTCDate(),h,min,zone);if(due>at)continue;if(!catchup&&at-due>16*60000)return null;return due.toISOString();
 }return null;
}
export function approvedDefinition(report){
 if(report.runner==='soe-account-outlook-v1')return {runner:report.runner,period:report.parameters?.period||'current',include_pending:report.parameters?.include_pending===true};
 if(report.runner!=='oracle-tabular-v1')return null;
 const sql=report.definition?.sql,bindings=report.definition?.bindings||{},limit=report.definition?.max_rows||2000000;
 if(typeof sql!=='string'||sql.length>100000||!/^\s*(SELECT|WITH)\b/i.test(sql)||/[;@]|--|\/\*/.test(sql)||/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|GRANT|REVOKE|EXECUTE|CALL|TRUNCATE|UTL_\w+|DBMS_\w+)\b/i.test(sql)||!/(?:FROM|JOIN)\s+(?:WAREUSER\.)?COST_COLLECTORS_ACCESSIBLE\b/i.test(sql)||typeof bindings!=='object'||Array.isArray(bindings)||Object.entries(bindings).some(([k,v])=>!/^\w{1,40}$/.test(k)||!['string','number'].includes(typeof v)||String(v).length>1000)||!Number.isSafeInteger(limit)||limit<1||limit>2000000)throw Error('The approved query definition is invalid.');
 const definition={runner:report.runner,sql,bindings,max_rows:limit};
 if(report.definition.output){
  if(report.validation!=='verified')throw Error('Nimbus source comparison must be verified before activation.');
  checkNimbusPilot({owner:'oconaill',reportId:report.id,id:'00000000-0000-0000-0000-000000000000',definition:report.definition});definition.output=clone(report.definition.output);
 }
 return definition;
}
export function createJobDispatcher({settings=settingsStore,now=()=>new Date(),uuid=randomUUID,key=encryptionKey,nimbusBatch=saveNimbusPilotBatch,signJob=value=>sign(null,Buffer.from(value),createPrivateKey({key:Buffer.from(process.env.WORKER_JOB_PRIVATE_KEY,'base64'),format:'der',type:'pkcs8'})).toString('base64url')}={}){return async({body,device,store:s})=>{
 const reply=(status,data)=>({status,data});
 const jobReply=job=>{const envelope=JSON.stringify({id:job.id,owner:job.owner,device:job.device,reportId:job.reportId,name:job.name,definition:job.definition,definition_hash:job.definition_hash,expires_at:job.expires_at});return reply(200,{job:{envelope:Buffer.from(envelope).toString('base64url'),signature:signJob(envelope)},poll_seconds:900});};
 const owner=device.owner,activeKey='active:'+owner;
 const settingsStorage=await settings(),catalogue=await settingsStorage.get('catalogue',{type:'json'}),preferences=await settingsStorage.get('preferences:'+owner,{type:'json'});
 if(catalogue?.schema!==1||!Array.isArray(catalogue.reports))return reply(409,{error:'Open Automatic reports once to initialize the catalogue.'});
 const reports=catalogue.reports.filter(r=>r.enabled!==false&&r.retired!==true&&(!r.owners||Array.isArray(r.owners)&&r.owners.includes(owner))),base=defaults(reports);
 const prefs=preferences?validatePreferences({...preferences.preferences,reports:Object.fromEntries(reports.map(r=>[r.id,preferences.preferences.reports?.[r.id]||base.reports[r.id]]))},reports):base;
 if(preferences&&preferences.owner!==owner)throw Error('Preference owner mismatch.');
 const currentDevice=await s.getWithMetadata('device:'+device.id,{type:'json'});
 if(!currentDevice||currentDevice.data.revoked||Date.parse(currentDevice.data.expires_at)<=now())return reply(403,{error:'This worker is no longer authorized.'});
 if(body.action==='check-in'){
  const capabilities=Array.isArray(body.capabilities)?body.capabilities.filter(v=>RUNNERS.includes(v)):[];
  if(!['2.0.0','2.0.1','2.0.2','2.0.3','2.0.4'].includes(body.worker_version)||!capabilities.length)return reply(400,{error:'Unsupported worker version or capabilities.'});
  const updated=await s.setJSON('device:'+device.id,{...currentDevice.data,worker_version:body.worker_version,capabilities,last_seen:now().toISOString(),source_available:typeof body.source_available==='boolean'?body.source_available:null},{onlyIfMatch:currentDevice.etag});if(!updated.modified)return reply(409,{error:'Device changed. Check in again.'});
  let active=await s.getWithMetadata(activeKey,{type:'json'});
  if(active?.data.status==='running'&&active.data.device===device.id&&body.abandon_job===active.data.id){await s.setJSON(activeKey,{...active.data,status:'interrupted'},{onlyIfMatch:active.etag});active=await s.getWithMetadata(activeKey,{type:'json'});}
  if(active?.data.status==='running'&&Date.parse(active.data.expires_at)>now()){
   if(active.data.device===device.id&&/^[a-f0-9-]{36}$/.test(body.client_request_id||'')&&active.data.client_request_id===body.client_request_id)return jobReply(active.data);
   return reply(200,{job:null,status:'A report is already running.',poll_seconds:900});
  }
  const queued=await s.getWithMetadata('manual-request:'+owner,{type:'json'});
  const manual=queued?.data.owner===owner&&!queued.data.claimed&&Date.parse(queued.data.expires_at)>now()&&reports.some(r=>r.id===queued.data.reportId)?queued:null;
  if(!body.force_report&&manual)body={...body,force_report:manual.data.reportId};
  if(prefs.paused&&!body.force_report)return reply(200,{job:null,status:'Automatic updates paused.',poll_seconds:900});
  if(body.source_available===false)return reply(200,{job:null,status:'Waiting for MIT network or VPN. Saved reports remain available.',poll_seconds:900});
  for(const report of reports){
   if(report.minimumRole!=='admin'||!capabilities.includes(report.runner)||body.force_report&&report.id!==body.force_report)continue;
   const pref=prefs.reports[report.id];if(!body.force_report&&!pref?.enabled)continue;
   const window=body.force_report?'manual:'+uuid():dueWindow(pref,prefs.timezone,now(),prefs.catchup);if(!window)continue;
   const last=await s.get('run-state:'+owner+':'+report.id,{type:'json'});
   if(!body.force_report&&(last?.success_window===window||last?.failed_window===window&&Date.parse(last.retry_after)>now()))continue;
   const definition=approvedDefinition(report);if(!definition)continue;
   const job={id:uuid(),owner,device:device.id,reportId:report.id,name:report.name,definition,definition_hash:hash(definition),window,status:'running',started_at:now().toISOString(),expires_at:new Date(+now()+4*3600000).toISOString(),rows:0,chunks:[],columns:null};
   if(/^[a-f0-9-]{36}$/.test(body.client_request_id||''))job.client_request_id=body.client_request_id;
   const claimed=await s.setJSON(activeKey,job,active?{onlyIfMatch:active.etag}:{onlyIfNew:true});if(!claimed.modified)return reply(200,{job:null,status:'Another computer claimed the report.',poll_seconds:900});
   if(manual&&manual.data.reportId===report.id)await s.setJSON('manual-request:'+owner,{...manual.data,claimed:job.id},{onlyIfMatch:manual.etag});
   return jobReply(job);
  }
  return reply(200,{job:null,status:'No reports are due.',poll_seconds:900});
 }
 const active=await s.getWithMetadata(activeKey,{type:'json'}),job=active?.data;
 if(!job||job.id!==body.job||job.owner!==owner||job.device!==device.id||Date.parse(job.expires_at)<=now())return reply(409,{error:'The report lease is no longer valid.'});
 const live=reports.find(r=>r.id===job.reportId);if(!live||hash(approvedDefinition(live))!==job.definition_hash)return reply(409,{error:'The report definition changed. Check in again.'});
 if(job.status==='succeeded'&&body.action==='complete'&&job.definition.runner==='oracle-tabular-v1'&&body.rows===job.rows)return reply(200,{saved:true,rows:job.rows,replayed:true});
 if(job.status==='succeeded'&&body.action==='complete'&&job.definition.runner==='soe-account-outlook-v1'){
  try{const saved=await s.get('latest:'+owner,{type:'json'});if(saved?.published_by===owner&&saved.device===device.id&&hash(normalizeReport(body.result))===hash(saved.result))return reply(200,{saved:true,rows:job.rows,replayed:true});}catch{}
 }
 if(job.status!=='running')return reply(409,{error:'The report lease is no longer valid.'});
 if(body.action==='failed'){
  await s.setJSON(activeKey,{...job,status:'failed',finished_at:now().toISOString()},{onlyIfMatch:active.etag});
  const old=await s.get('run-state:'+owner+':'+job.reportId,{type:'json'})||{};
  await s.setJSON('run-state:'+owner+':'+job.reportId,{...old,failed_window:job.window,retry_after:new Date(+now()+30*60000).toISOString(),last_error:'Worker could not complete the report. Last successful data retained.',last_error_code:/^[A-Z][A-Z0-9_]{0,39}$/.test(body.error_code||'')?body.error_code:null,last_error_stage:['extracting','uploading','completing'].includes(body.stage)?body.stage:null});return reply(200,{recorded:true});
 }
 if(body.action==='batch'){
  if(job.definition.runner==='oracle-tabular-v1'&&body.index===job.chunks.length-1&&body.index>=0&&JSON.stringify(body.columns)===JSON.stringify(job.columns)&&Array.isArray(body.rows)&&body.rows.length>0&&body.rows.length<=1000){
   let digest;try{digest=job.definition.output?.kind==='nimbus-snapshot-v1'?hash(validRows(body.rows,null,1000)):hash({columns:body.columns,rows:body.rows});}catch{return reply(400,{error:'Invalid report batch.'});}
   const previous=job.chunks[body.index];return previous.hash===digest&&previous.rows===body.rows.length?reply(200,{rows:job.rows,replayed:true}):reply(409,{error:'Retry payload does not match the accepted batch.'});
  }
  if(job.chunks.length>=8000||job.definition.runner!=='oracle-tabular-v1'||body.index!==job.chunks.length||!Array.isArray(body.columns)||!body.columns.length||body.columns.length>100||body.columns.some(c=>typeof c!=='string'||c.length>200)||new Set(body.columns).size!==body.columns.length||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>1000||body.rows.some(row=>!Array.isArray(row)||row.length!==body.columns.length||row.some(v=>v!==null&&(!['string','number','boolean'].includes(typeof v)||typeof v==='string'&&v.length>20000||typeof v==='number'&&!Number.isFinite(v))))||job.columns&&JSON.stringify(job.columns)!==JSON.stringify(body.columns)||job.rows+body.rows.length>job.definition.max_rows)return reply(400,{error:'Invalid report batch.'});
  let chunk;
  if(job.definition.output?.kind==='nimbus-snapshot-v1')chunk=await nimbusBatch(job,body);
  else{const id='chunk:'+owner+':'+job.id+':'+body.index,payload={columns:body.columns,rows:body.rows};await s.set(id,seal(payload,key(),id));chunk={id,hash:hash(payload),rows:body.rows.length};}
  job.columns=body.columns;job.rows+=body.rows.length;job.chunks.push(chunk);const saved=await s.setJSON(activeKey,job,{onlyIfMatch:active.etag});return saved.modified?reply(200,{rows:job.rows}):reply(409,{error:'The report changed; do not publish.'});
 }
 if(body.action==='complete'){
  let stored;
  if(job.definition.runner==='soe-account-outlook-v1'){
   let result;try{result=normalizeReport(body.result);}catch{return reply(400,{error:'Invalid account report.'});}
   const previous=await s.getWithMetadata('latest:'+owner,{type:'json'});if(previous&&Date.parse(result.retrieved)<=Date.parse(previous.data.result.retrieved))return reply(409,{error:'A newer pilot report is already available.'});
   stored={schema:1,published_by:owner,device:device.id,published_at:now().toISOString(),result};const saved=await s.setJSON('latest:'+owner,stored,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});if(!saved.modified)return reply(409,{error:'Another report was published.'});job.rows=result.rows.length;
  }else{
   if(!job.rows||body.rows!==job.rows||!job.columns)return reply(400,{error:'Incomplete query output. Previous report retained.'});
   stored={schema:1,owner,job:job.id,reportId:job.reportId,published_at:now().toISOString(),rows:job.rows,columns:job.columns,chunks:job.chunks,definition_hash:job.definition_hash};
   if(job.definition.output?.kind==='nimbus-snapshot-v1')stored={...stored,storage:job.chunks.every(c=>c.content_addressed===true)?'quickbase-nimbus-pilot-v2':'quickbase-nimbus-pilot-v1',scope:checkNimbusPilot(job)};
   await s.setJSON('latest-report:'+owner+':'+job.reportId,stored);
  }
  const finished={...job,status:'succeeded',finished_at:now().toISOString()};await s.setJSON(activeKey,finished,{onlyIfMatch:active.etag});
  const prior=await s.get('run-state:'+owner+':'+job.reportId,{type:'json'})||{};await s.setJSON('run-state:'+owner+':'+job.reportId,{...prior,success_window:job.window,last_success_at:finished.finished_at,rows:job.rows});
  const history=await s.get('activity:'+owner,{type:'json'})||[];await s.setJSON('activity:'+owner,[{report:job.name,reportId:job.reportId,at:finished.finished_at,status:'Saved successfully',device:device.id,rows:job.rows},...history].slice(0,100));return reply(200,{saved:true,rows:job.rows});
 }
 return reply(400,{error:'Unknown worker action.'});
};}
export async function readTabularResult(store,owner,reportId,page=1,key=encryptionKey){
 if(!/^[-a-z0-9]{1,60}$/.test(reportId)||!Number.isSafeInteger(page)||page<1)throw Error('Invalid report request.');
 const m=await store.get('latest-report:'+owner+':'+reportId,{type:'json'});if(!m)return null;if(m.owner!==owner||m.reportId!==reportId||!Array.isArray(m.chunks))throw Error('Invalid report scope.');
 if(['quickbase-nimbus-pilot-v1','quickbase-nimbus-pilot-v2'].includes(m.storage))return readNimbusPilotPage(m,owner,reportId,page);
 const start=(page-1)*100,end=Math.min(start+100,m.rows),rows=[];let offset=0;
 for(const c of m.chunks){if(offset+c.rows>start&&offset<end){const cipher=await store.get(c.id,{type:'text'}),value=unseal(cipher,key(),c.id);if(hash(value)!==c.hash||JSON.stringify(value.columns)!==JSON.stringify(m.columns))throw Error('Report integrity check failed.');rows.push(...value.rows.slice(Math.max(0,start-offset),end-offset));}offset+=c.rows;}
 return {columns:m.columns,rows,total:m.rows,page,pages:Math.max(1,Math.ceil(m.rows/100)),published_at:m.published_at};
}
