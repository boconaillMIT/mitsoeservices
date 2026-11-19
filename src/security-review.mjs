import access from './access.cjs';
import policy from './policy.cjs';
import units from './units.cjs';
import flags from './features.cjs';
import {hubLayout} from './unit-hub.mjs';
import {readFileReview} from './unit-files.mjs';
const byDate=(a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0);
export function reviewAccess(data,scope){
 if(scope==='all')return data.grants.map(g=>({username:g.username,scope:g.scope,role:policy.roleLabels(g.scope)[g.role],full:g.role.startsWith('limited_')?'No access':policy.roleLabels(g.scope)[g.role],limited:policy.roleLabels(g.scope)[g.role],inherited:g.scope==='school'}));
 return [...new Set(data.grants.map(g=>g.username))].sort().flatMap(username=>{
  const full=policy.effectiveRole(data,username,scope,'full'),limited=policy.effectiveRole(data,username,scope,'limited');
  if(!limited)return [];
  return [{username,scope,role:policy.roleLabels(scope)[limited],full:full?policy.roleLabels(scope)[full]:'No access',limited:policy.roleLabels(scope)[limited],inherited:data.grants.some(g=>g.username===username&&g.scope==='school'&&(scope!=='rct'||g.role==='admin'))}];
 });
}
export function createSecurityReviewHandler({authorize=access.authorize,files=readFileReview,visibility=()=>flags.loadFlags(),now=()=>new Date()}={}){return async event=>{
 const page=event.path==='/settings/security-review',reply=(status,value)=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(value)});
 if(event.httpMethod!=='GET')return reply(405,{error:'Read-only review; GET required.'});
 const auth=await authorize(event,{scope:'school',minimum:'admin'});
 if(page&&auth.statusCode===401)return {statusCode:302,headers:{...access.noStore,Location:'/.netlify/functions/auth-login?returnTo=%2Fsettings%2Fsecurity-review'},body:''};
 if(!auth.user)return auth;
 if(!auth.admin||auth.testView)return reply(403,{error:'SoE-wide administrator access is required.'});
 if(page){
  const table=(id,headers)=>`<div class="wallet-table"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody id="${id}"></tbody></table></div>`;
  const body=`<p><a href="/settings">← Settings</a> · <a href="/settings/manage-access">Manage access</a></p><section class="card"><h2>Review access and sharing</h2><p>This read-only dashboard is available only to SoE-wide administrators. It shows current website permissions and the changes retained by the app.</p><form id="security-filters"><label>School or unit<select id="security-unit"><option value="all">All grants and units</option></select></label><label>Filter by MIT login or filename<input id="security-search" type="search" maxlength="200"></label><button id="security-refresh" type="button">Refresh review</button></form><p id="security-status" role="status">Loading security review…</p><p id="security-counts"></p></section><section class="card"><h2>Current access</h2><p id="access-description"></p>${table('security-access',['MIT login','Scope','Full access','Limited access','School inheritance'])}</section><section class="card"><h2>Recent permission changes</h2><p>Up to the last 200 retained permission events. Earlier events and previous role values may not have been recorded.</p>${table('security-permissions',['When (Eastern Time)','Changed by','MIT login','Scope','Action / role'])}</section><section class="card"><h2>Document access changes</h2><p>Full → Limited changes are highlighted because they widen the document audience. History retains up to 20 changes per file; older changes may not be available.</p>${table('security-documents',['When (Eastern Time)','Changed by','Unit','File','Access change'])}<h3>Current document inventory</h3>${table('security-files',['Unit','File','Current access','Uploaded by','Uploaded (Eastern Time)'])}</section><section class="card"><h2>Resource visibility changes</h2><p>Up to the last 100 retained visibility events. Visibility switches do not grant permissions.</p>${table('security-visibility',['When (Eastern Time)','Changed by','Audience','Changes'])}</section>`;
  return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/html; charset=utf-8'},body:hubLayout('Security review',body,true,'',true,true,auth.navigation,'<script src="/security-review.js" defer></script>')};
 }
 const scope=event.queryStringParameters?.scope||'all';
 if(scope!=='all'&&!Object.hasOwn(policy.SCOPES,scope))return reply(400,{error:'Choose a valid school or unit.'});
 try{
  const data=auth.policy.data,[documents,visible]=await Promise.all([files({scopes:scope==='all'||scope==='school'?Object.keys(units.ALL_UNITS):scope==='rct'?[]:[scope]}),visibility()]);
  const relevant=a=>scope==='all'||a.scope===scope||a.scope==='school'&&(scope!=='rct'||a.role==='admin'||a.previous_role==='admin');
  return reply(200,{checked_at:now().toISOString(),scope,scopes:policy.SCOPES,access:reviewAccess(data,scope),permissions:data.audit.filter(relevant).slice(-200).sort(byDate),files:documents,visibility:visible.data.audit.slice(0,100),coverage:{permission_events_retained:200,document_changes_per_file:20,visibility_events_retained:100}});
 }catch{return reply(503,{error:'The security review could not be fully verified. No incomplete review or other unit data was substituted.'});}
};}
export const handler=createSecurityReviewHandler();
