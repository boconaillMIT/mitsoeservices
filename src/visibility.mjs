import access from './access.cjs';import flags from './features.cjs';import {hubLayout} from './unit-hub.mjs';
export function createVisibilityHandler({authorize=access.authorize,store=flags.featureStore,now=()=>new Date()}={}){return async event=>{
 const reply=(status,data)=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(data)});
 const page=event.path==='/settings/visibility';
 const auth=await authorize(event,{scope:'school',minimum:'admin',loadFeatures:async()=>({data:flags.defaults()})});
 if(page&&auth.statusCode===401)return {statusCode:302,headers:{...access.noStore,Location:'/.netlify/functions/auth-login?returnTo=%2Fsettings%2Fvisibility'},body:''};
 if(!auth.user)return auth;
 if(page){if(event.httpMethod!=='GET')return reply(405,{error:'GET required.'});const rows=Object.entries(flags.DEFINITIONS).map(([key,label])=>`<tr><th>${label}</th><td id="current-${key}">Loading…</td><td><input type="checkbox" name="${key}" aria-label="Show ${label}" disabled></td></tr>`).join('');
  const body=`<p><a href="/settings">← Settings</a></p><section class="card"><h2>Show or hide resources</h2><p>These switches control links, pages, and data endpoints. They never grant access to someone who lacks the underlying permission.</p><form id="visibility-form"><label>Apply changes to<select id="visibility-target"><option value="everyone">Everyone (SoE roles and unit-only users)</option><option value="units">Unit-only users (no SoE-level role)</option></select></label><div class="wallet-table"><table><thead><tr><th>Resource</th><th>Current visibility</th><th>Visible for selected audience</th></tr></thead><tbody>${rows}</tbody></table></div><p>For unit-only changes, SoE-role visibility stays unchanged. Test DAF view follows unit-only settings.</p><button disabled id="visibility-save">Save visibility</button><p id="visibility-status" role="status">Loading current visibility…</p></form></section><section class="card"><h2>Recent changes</h2><ul id="visibility-audit"></ul></section>`;
  return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/html; charset=utf-8'},body:hubLayout('Resource visibility',body,true,'',true,true,auth.navigation,'<script src="/visibility.js" defer></script>')};
 }
 if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'GET or POST required.'});
 try{
  const s=await store(),current=await flags.loadFlags(s);
  if(event.httpMethod==='GET')return reply(200,{policy:current.data,version:current.etag});
  const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));if(!process.env.APP_ORIGIN||h.origin!==process.env.APP_ORIGIN||h['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
  if(typeof event.body!=='string'||event.body.length>4000)return reply(400,{error:'Invalid visibility request.'});
  let body;try{body=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid JSON.'});}
  if(!['everyone','units'].includes(body?.target)||body.version!==current.etag||!body.changes||Object.keys(body.changes).length<1||Object.keys(body.changes).length>Object.keys(flags.DEFINITIONS).length||Object.keys(body.changes).some(k=>!Object.hasOwn(flags.DEFINITIONS,k)||typeof body.changes[k]!=='boolean'))return reply(409,{error:'Settings changed or the selection is invalid. Reload before saving.'});
  const next=structuredClone(current.data);for(const [key,shown]of Object.entries(body.changes)){next.features[key].units=shown;if(body.target==='everyone')next.features[key].school=shown;}
  next.audit=[{by:auth.kerberos,at:now().toISOString(),target:body.target,changes:body.changes},...next.audit].slice(0,100);flags.validate(next);
  const saved=await s.setJSON('feature-policy',next,current.etag?{onlyIfMatch:current.etag}:{onlyIfNew:true});if(!saved.modified)return reply(409,{error:'Another administrator changed visibility. Reload.'});
  const verified=await flags.loadFlags(s);return reply(200,{policy:verified.data,version:verified.etag});
 }catch{return reply(503,{error:'Visibility could not be loaded or saved. No permissions were changed.'});}
};}
export const handler=createVisibilityHandler();
