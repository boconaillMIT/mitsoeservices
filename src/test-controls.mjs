import access from './access.cjs';
import policy from './policy.cjs';
import view from './test-view.cjs';
import {hubLayout} from './unit-hub.mjs';
export function createTestControlsHandler(authorize=access.authorize){return async event=>{
 const auth=await authorize(event,{scope:'any',audience:'limited'});
 if(auth.statusCode===401)return {statusCode:302,headers:{...access.noStore,Location:'/.netlify/functions/auth-login?returnTo=%2Ftesting%2Fsoe-fake'},body:''};
 if(!auth.user)return auth;
 if(auth.kerberos!=='oconaill'||policy.effectiveRole((auth.actualPolicy||auth.policy).data,'oconaill','school')!=='admin')return {statusCode:403,headers:access.noStore,body:'This private DAF test control is available to Brian only.'};
 if(event.httpMethod==='POST'){
  const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!process.env.APP_ORIGIN||h.origin!==process.env.APP_ORIGIN||h['content-type']?.split(';')[0]!=='application/x-www-form-urlencoded')return {statusCode:403,headers:access.noStore,body:'Same-origin form required.'};
  const action=new URLSearchParams(event.body||'').get('action');
  if(!['enter','exit'].includes(action))return {statusCode:400,headers:access.noStore,body:'Invalid test action.'};
  return {statusCode:303,headers:{...access.noStore,Location:action==='enter'?'/units/soe-fake/full':'/testing/soe-fake','Set-Cookie':view.COOKIE+'='+ (action==='enter'?'1':'')+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+(action==='enter'?'3600':'0')},body:''};
 }
 if(event.httpMethod!=='GET')return {statusCode:405,headers:access.noStore,body:'GET or POST required.'};
 const body=`<section class="card"><h2>Fictional unit for permission testing</h2><p>Wallet, account, and Nimbus records are entirely invented. No live financial data is copied or refreshed here.</p><p>Current browser view: <strong>${auth.testView?'SOE Fake unit administrator':'Your normal administrator access'}</strong>.</p><form method="post" action="/testing/soe-fake"><input type="hidden" name="action" value="${auth.testView?'exit':'enter'}"><button>${auth.testView?'Exit DAF test view':'Enter DAF test view'}</button></form><p>DAF test view temporarily restricts your browser requests to SOE Fake. It expires after one hour. Your real grants and background report schedules stay unchanged. This exercises unit authorization using your existing sign-in; a separate test login is still needed to validate another person’s complete SSO journey.</p><p><a href="/units/soe-fake/full">SOE Fake Full access →</a></p><p><a href="/units/soe-fake/limited">SOE Fake Limited Access →</a></p></section>`;
 return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/html; charset=utf-8'},body:hubLayout('SOE Fake testing',body,auth.canManage,'',auth.admin,auth.schoolAccess,auth.navigation)};
};}
export const handler=createTestControlsHandler();
