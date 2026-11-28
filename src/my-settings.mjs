import access from './access.cjs';
import policy from './policy.cjs';
import {hubLayout} from './unit-hub.mjs';
export const defaultPersonalSettings=()=>({accountView:'simple'});
export function validatePersonalSettings(value){if(!value||Array.isArray(value)||Object.keys(value).length!==1||!['simple','advanced'].includes(value.accountView))throw Error('Invalid personal settings');return {accountView:value.accountView};}
export async function personalSettingsStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'mitsoeservices-personal-settings-'+policy.deploymentName(),consistency:'strong'});}
export function createMySettingsHandler({authorize=access.authorize,store=personalSettingsStore,now=()=>new Date()}={}){return async event=>{
 const data=event.path==='/my-settings/data'||event.queryStringParameters?.action==='data',reply=(statusCode,body)=>({statusCode,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!['GET','POST'].includes(event.httpMethod)||!data&&event.httpMethod!=='GET')return reply(405,{error:'Unsupported settings operation.'});
 const auth=await authorize(event,{scope:'any',audience:'limited'});if(!auth.user){if(!data&&auth.statusCode===401)return {statusCode:302,headers:{...access.noStore,Location:'/.netlify/functions/auth-login?returnTo=%2Fmy-settings'},body:''};return auth;}
 if(!policy.validUsername(auth.kerberos))return reply(403,{error:'Your MIT login could not be verified.'});
 if(!data)return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/html; charset=utf-8'},body:hubLayout('My settings',`<section class="card"><h2>Account view</h2><p>Your settings apply only to you, wherever you sign in.</p><form id="my-settings-form"><label for="my-account-view">Default account view</label><select id="my-account-view" disabled><option value="simple">Simple — current balance and expenses to date</option><option value="advanced">Advanced — include projections and funding details</option></select><p>Simple is the default. Advanced adds year-end projections, commitments, wallet history and projection assumptions.</p><button id="my-settings-save" disabled>Save my settings</button></form><p id="my-settings-status" role="status">Loading your settings…</p><p><a href="/my-authorizations">My authorizations →</a></p></section>`,auth.canManage,'',auth.admin,auth.schoolAccess,{...auth.navigation,aeroastroWorkspace:auth.navigation?.aeroastroFinance===true&&auth.navigation?.compactUnits===true,activeNav:'my-settings'},'<link rel="stylesheet" href="/my-settings.css"><script type="module" src="/my-settings.js"></script>')};
 const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
 if(event.httpMethod==='POST'&&(auth.testView||!process.env.APP_ORIGIN||headers.origin!==process.env.APP_ORIGIN||headers['content-type']?.split(';')[0]!=='application/json'))return reply(403,{error:auth.testView?'Return to your own view before saving personal settings.':'Same-origin JSON required.'});
 try{
  const s=await store(),key='user:'+auth.kerberos,previous=await s.getWithMetadata(key,{type:'json'});
  if(previous&&(previous.data?.owner!==auth.kerberos||previous.data?.schema!==1))throw Error('Settings owner mismatch');
  const settings=previous?validatePersonalSettings(previous.data.settings):defaultPersonalSettings(),version=previous?.etag||null;
  if(event.httpMethod==='GET')return reply(200,{settings,version});
  if(typeof event.body!=='string'||event.body.length>2000)return reply(400,{error:'Invalid settings request.'});
  let b;try{b=JSON.parse(event.body);if(!b||Object.keys(b).some(k=>!['settings','version'].includes(k)))throw Error();b.settings=validatePersonalSettings(b.settings);}catch{return reply(400,{error:'Choose Simple or Advanced.'});}
  if(b.version!==version)return reply(409,{error:'Your settings changed elsewhere. Reload before saving.'});
  const saved=await s.setJSON(key,{schema:1,owner:auth.kerberos,settings:b.settings,updatedAt:now().toISOString()},previous?{onlyIfMatch:version}:{onlyIfNew:true});
  if(!saved.modified)return reply(409,{error:'Your settings changed elsewhere. Reload before saving.'});
  const checked=await s.getWithMetadata(key,{type:'json'});if(checked?.data?.owner!==auth.kerberos||JSON.stringify(checked.data.settings)!==JSON.stringify(b.settings))throw Error('Settings readback failed');
  return reply(200,{saved:true,settings:b.settings,version:checked.etag});
 }catch{return reply(503,{error:'Your settings could not be loaded or confirmed. Please try again.'});}
};}
export const handler=createMySettingsHandler();
