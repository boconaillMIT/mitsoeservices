import access from './access.cjs';import units from './units.cjs';import {hubLayout} from './unit-hub.mjs';import {audienceHtml} from './audience.cjs';
export function allocationCard(scope){return `<section class="card" id="unit-allocations"><h2>Annual allocations</h2><p>Rewards and Recognition, Underrecovery, and RA tuition subsidy. Blank means no allocation has been provided yet.</p><label>Fiscal year<select id="allocation-year"><option value="2027">FY27</option><option value="2028">FY28</option></select></label><p id="allocation-freshness" class="small"></p><p id="allocation-status" role="status">Loading allocations…</p><div class="wallet-table"><table><thead><tr><th>Unit</th><th>Fiscal year</th><th>Rewards and Recognition</th><th>Underrecovery</th><th>RA tuition subsidy</th></tr></thead><tbody id="allocation-rows"></tbody><tfoot id="allocation-totals"></tfoot></table></div><p id="allocation-admin-link"></p></section>`;}
export function createAllocationsPageHandler(authorize=access.authorize){return async event=>{
 if(event.httpMethod!=='GET')return {statusCode:405,headers:access.noStore,body:'GET required.'};
 const path=event.path||'',scope=path==='/soe-hq/allocations'?'all':/^\/(?:units|other-units)\/([a-z-]+)\/allocations\/?$/.exec(path)?.[1]||event.queryStringParameters?.unit||'all';
 if(scope!=='all'&&!Object.hasOwn(units.ALL_UNITS,scope))return {statusCode:404,headers:access.noStore,body:'Unit not found.'};
 const auth=await authorize(event,{scope:scope==='all'?'school':scope,minimum:scope==='all'?'admin':'read'});
 if(auth.statusCode===401)return {statusCode:302,headers:{...access.noStore,Location:'/.netlify/functions/auth-login?returnTo='+encodeURIComponent(scope==='all'?'/soe-hq/allocations':units.unitPath(scope).replace(/\/full$/,'/allocations'))},body:''};
 if(!auth.user)return auth;
 const title=scope==='all'?'All-unit allocations':units.ALL_UNITS[scope].label+' allocations',audience=scope==='all'?'<p>Visible only to SoE-wide administrators.</p>':audienceHtml((auth.actualPolicy||auth.policy).data,scope,'full');
 return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/html; charset=utf-8'},body:hubLayout(title,allocationCard(scope),auth.canManage,audience,auth.admin,auth.schoolAccess,auth.navigation,'<script type="module" src="/unit-allocations.js"></script>',` data-allocation-unit="${scope}"`)};
};}
export const handler=createAllocationsPageHandler();
