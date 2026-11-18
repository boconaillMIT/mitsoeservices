import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import access from '../../src/access.cjs';
import navigation from '../../src/navigation.cjs';
import {eventFrom,responseFrom} from '../../src/http.mjs';
const handler = async request => {
  if (request.method !== 'GET') return new Response('GET required',{status:405,headers:access.noStore});
  const result=await access.authorize(eventFrom(request),{scope:'any',audience:'limited'});
  if(result.statusCode===401) return new Response(null,{status:302,headers:{...access.noStore,
    Location:'/.netlify/functions/auth-login?returnTo=%2Fadmin'}});
  if(!result.user) return responseFrom(result);
  if(request.url.includes('/settings/manage-access')&&!result.schoolAccess)return new Response('SoE HQ access required.',{status:403,headers:access.noStore});
  if(!result.canManage) return new Response('Administrator access required.',{status:403,headers:access.noStore});
  return new Response((await readFile(join(process.cwd(),'src/admin.html'),'utf8')).replace('</h1>','</h1>'+(result.admin?'<p><a href="/settings/security-review">Security review</a> · <a href="/settings/visibility">Resource visibility</a> · <a href="/soe-hq/allocations">All-unit allocations</a></p>':'')).replace('<!--MAIN-NAV-->',navigation.mainNavigation({manage:true,schoolAdmin:result.admin,schoolAccess:result.schoolAccess,visibility:result.navigation,active:result.schoolAccess?'settings-admin':'admin'})),{
    headers:{...access.noStore,'Content-Type':'text/html; charset=utf-8'}});
};

import policy from '../../src/policy.cjs';
export default (request,context)=>policy.withPolicyContext(context,()=>handler(request));
