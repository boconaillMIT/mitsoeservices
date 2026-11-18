import access from './access.cjs';
import policy from './policy.cjs';
import {eventFrom} from './http.mjs';
const reply = (status,data) => Response.json(data,{status,headers:access.noStore});
export function createAdminHandler({authorize=access.authorize, change=policy.changePolicy}={}) {
  return async request => {
    const result = await authorize(eventFrom(request),{scope:'any',audience:'limited'});
    if (!result.user) return reply(result.statusCode,{error:result.body});
    if (!result.admin&&!result.canManage) return reply(403,{error:'Administrator access required.'});
    const view=saved=>{
      const managed=result.testView?['soe-fake']:policy.managedScopes(saved.data,result.kerberos),school=managed.includes('school');
      const grants=saved.data.grants.filter(g=>managed.includes(g.scope));
      return {users:[...new Set(grants.map(g=>g.username))],grants,scopes:Object.fromEntries(Object.entries(policy.SCOPES).filter(([key])=>managed.includes(key))),roleLabels:Object.fromEntries(managed.map(scope=>[scope,policy.roleLabels(scope)])),admins:grants.filter(g=>g.role==='admin').map(g=>g.username),protectedAdmins:policy.PROTECTED_ADMINS,audit:saved.data.audit.filter(a=>school||managed.includes(a.scope)),version:saved.etag};
    };
    if (request.method === 'GET') return reply(200,view(result.actualPolicy||result.policy));
    if (request.method !== 'POST') return reply(405,{error:'GET or POST required.'});
    if (!process.env.APP_ORIGIN || request.headers.get('origin') !== process.env.APP_ORIGIN ||
        request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      return reply(403,{error:'Same-origin JSON request required.'});
    if (Number(request.headers.get('content-length') || 0)>2048) return reply(413,{error:'Request too large.'});
    let data;
    try {
      const body=await request.text();
      if(body.length>2048) return reply(413,{error:'Request too large.'});
      data=JSON.parse(body);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid body');
    } catch {return reply(400,{error:'Invalid request.'});}
    try {
      if(result.testView&&data.scope!=='soe-fake')return reply(403,{error:'DAF test view can manage SOE Fake only.'});
      const saved=await change(result.kerberos,data.action,data.username,data.version,undefined,{scope:data.scope,role:data.role});
      if(saved.status!==200) return reply(saved.status,{error:saved.error});
      return reply(200,view(saved));
    } catch {return reply(503,{error:'Access changes could not be saved. Refresh before retrying.'});}
  };
}
