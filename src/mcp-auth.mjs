// OAuth 2.1 authorization server for the Claude connector (remote MCP).
// Sign-in reuses the site's MIT Okta session; only school-wide administrators in the
// site's access policy can authorize. Tokens are AES-256-GCM sealed with a key derived
// from SESSION_SECRET, so nothing new is stored or configured. Authorization codes are
// single-use (recorded in Netlify Blobs) and bound to PKCE S256 and Claude's callback URL.
import {createCipheriv,createDecipheriv,createHash,hkdfSync,randomBytes,timingSafeEqual} from 'node:crypto';
import policy from './policy.cjs';

export const ALLOWED_REDIRECTS=Object.freeze(['https://claude.ai/api/mcp/auth_callback','https://claude.com/api/mcp/auth_callback']);
export const CLIENT_ID='mitsoeservices-claude';
export const SCOPE='budget:read';
const TTL={code:300,access:3600,refresh:30*86400};
const noStore={'Cache-Control':'no-store','Pragma':'no-cache'};

export function origin(env=process.env){
 const o=new URL(env.APP_ORIGIN||'');
 if(o.origin!==env.APP_ORIGIN||!(o.protocol==='https:'||(o.protocol==='http:'&&o.hostname==='localhost')))throw Error('APP_ORIGIN must be an HTTPS origin');
 return o.origin;
}
function key(env=process.env){
 if(!env.SESSION_SECRET||env.SESSION_SECRET.length<32)throw Error('SESSION_SECRET is not configured');
 return Buffer.from(hkdfSync('sha256',env.SESSION_SECRET,'MITSOEServices Claude connector','mcp-oauth-v1',32));
}
export function seal(kind,payload,{env=process.env,now=Date.now()}={}){
 const body={...payload,kind,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+TTL[kind],jti:randomBytes(12).toString('base64url')};
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(env),iv);c.setAAD(Buffer.from('mcp:'+kind));
 const data=Buffer.concat([c.update(JSON.stringify(body),'utf8'),c.final()]);
 return [iv,data,c.getAuthTag()].map(b=>b.toString('base64url')).join('.');
}
export function open(kind,token,{env=process.env,now=Date.now()}={}){
 try{
  const parts=String(token||'').split('.');if(parts.length!==3||String(token).length>4000)return null;
  const [iv,data,tag]=parts.map(p=>Buffer.from(p,'base64url'));
  const d=createDecipheriv('aes-256-gcm',key(env),iv);d.setAAD(Buffer.from('mcp:'+kind));d.setAuthTag(tag);
  const body=JSON.parse(Buffer.concat([d.update(data),d.final()]).toString('utf8'));
  if(body.kind!==kind||!Number.isInteger(body.exp)||body.exp<=Math.floor(now/1000))return null;
  return body;
 }catch{return null;}
}
const json=(status,data,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...noStore,...headers}});
const oauthError=(status,error,description)=>json(status,{error,error_description:description});
const esc=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

export function resourceMetadata(env=process.env){
 const o=origin(env);
 return json(200,{resource:o+'/mcp',authorization_servers:[o],scopes_supported:[SCOPE],bearer_methods_supported:['header'],resource_name:'MIT SoE Services'},{'Cache-Control':'public, max-age=300'});
}
export function serverMetadata(env=process.env){
 const o=origin(env);
 return json(200,{issuer:o,authorization_endpoint:o+'/mcp-oauth/authorize',token_endpoint:o+'/mcp-oauth/token',registration_endpoint:o+'/mcp-oauth/register',
  response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],
  token_endpoint_auth_methods_supported:['none'],scopes_supported:[SCOPE]},{'Cache-Control':'public, max-age=300'});
}

// Dynamic client registration: only Claude's own callback URLs are accepted.
export async function register(request){
 if(request.method!=='POST')return oauthError(405,'invalid_request','POST required');
 let body;try{body=await request.json();}catch{return oauthError(400,'invalid_client_metadata','JSON body required');}
 const uris=Array.isArray(body?.redirect_uris)?body.redirect_uris:[];
 if(!uris.length||uris.some(u=>!ALLOWED_REDIRECTS.includes(u)))return oauthError(400,'invalid_redirect_uri','Only Claude connector callbacks are allowed');
 return json(201,{client_id:CLIENT_ID,client_name:'Claude',redirect_uris:uris,grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:SCOPE,client_id_issued_at:Math.floor(Date.now()/1000)});
}

function readAuthorizeParams(params){
 const p=k=>params.get(k)||'';
 const req={client_id:p('client_id'),redirect_uri:p('redirect_uri'),state:p('state'),code_challenge:p('code_challenge'),code_challenge_method:p('code_challenge_method'),response_type:p('response_type')};
 if(req.client_id!==CLIENT_ID)return {fatal:'Unknown client.'};
 if(!ALLOWED_REDIRECTS.includes(req.redirect_uri))return {fatal:'This sign-in link is not for a Claude connector.'};
 if(req.response_type!=='code')return {error:'unsupported_response_type',req};
 if(req.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43,128}$/.test(req.code_challenge))return {error:'invalid_request',req};
 if(req.state.length>1000)return {error:'invalid_request',req};
 return {req};
}
const redirectTo=(req,params)=>{const u=new URL(req.redirect_uri);for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);if(req.state)u.searchParams.set('state',req.state);return new Response(null,{status:302,headers:{Location:u.toString(),...noStore}});};
const page=(status,title,inner)=>new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="/style.css"></head><body><main class="container"><h1>${esc(title)}</h1>${inner}</main></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8',...noStore}});

export function isSchoolAdmin(data,kerberos){return Boolean(kerberos)&&policy.effectiveRole(data,kerberos,'school')==='admin';}

// GET shows a consent page to the signed-in MIT user; POST (same origin) issues the code.
export function createAuthorize({readSession,loadPolicy=policy.loadPolicy,markUsed,env=process.env,now=()=>Date.now()}){return async request=>{
 const o=origin(env),url=new URL(request.url);
 let params=url.searchParams;
 if(request.method==='POST'){
  if(request.headers.get('origin')!==o)return page(403,'Request rejected','<p>Please start again from Claude.</p>');
  params=new URLSearchParams(await request.text());
 }else if(request.method!=='GET')return page(405,'Not allowed','');
 const parsed=readAuthorizeParams(params);
 if(parsed.fatal)return page(400,'Connector sign-in failed','<p>'+esc(parsed.fatal)+'</p>');
 if(parsed.error)return redirectTo(parsed.req,{error:parsed.error});
 const req=parsed.req;
 const user=await readSession(request);
 if(!user){
  const back='/mcp-oauth/authorize?'+new URLSearchParams(Object.entries(req)).toString();
  return new Response(null,{status:302,headers:{Location:'/.netlify/functions/auth-login?returnTo='+encodeURIComponent(back),...noStore}});
 }
 const kerberos=policy.normalizeLogin(user.kerberos);
 let current;try{current=await loadPolicy();}catch{return page(503,'Access check unavailable','<p>Please try again shortly.</p>');}
 if(!isSchoolAdmin(current.data,kerberos))return redirectTo(req,{error:'access_denied',error_description:'Only MITSOEServices school administrators can connect Claude.'});
 if(request.method==='GET'){
  const hidden=Object.entries(req).map(([k,v])=>`<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return page(200,'Connect Claude to MIT SoE Services',`<p>Signed in as <strong>${esc(kerberos)}@mit.edu</strong>.</p><p>Claude will be able to <strong>read</strong> the SoE budget request records in QuickBase on your behalf, using your administrator access. It cannot change any records.</p><p>You can disconnect at any time in Claude's connector settings.</p><form method="post" action="/mcp-oauth/authorize">${hidden}<button type="submit" name="decision" value="allow">Allow</button> <button type="submit" name="decision" value="deny">Cancel</button></form>`);
 }
 if(params.get('decision')!=='allow')return redirectTo(req,{error:'access_denied'});
 const code=seal('code',{sub:kerberos,redirect_uri:req.redirect_uri,code_challenge:req.code_challenge,client_id:CLIENT_ID,scope:SCOPE},{env,now:now()});
 console.log('Claude connector: authorization granted for',kerberos);
 return redirectTo(req,{code});
};}

const pkce=verifier=>createHash('sha256').update(verifier).digest('base64url');
const same=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
function tokens(sub,{env,now}){return json(200,{access_token:seal('access',{sub,scope:SCOPE},{env,now}),token_type:'Bearer',expires_in:TTL.access,refresh_token:seal('refresh',{sub,scope:SCOPE},{env,now}),scope:SCOPE});}

export function createToken({loadPolicy=policy.loadPolicy,markUsed,env=process.env,now=()=>Date.now()}){return async request=>{
 if(request.method!=='POST')return oauthError(405,'invalid_request','POST required');
 const type=request.headers.get('content-type')||'';let p;
 try{p=type.includes('application/json')?new URLSearchParams(Object.entries(await request.json()).map(([k,v])=>[k,String(v)])):new URLSearchParams(await request.text());}catch{return oauthError(400,'invalid_request','Unreadable body');}
 const grant=p.get('grant_type'),t=now();
 if(p.get('client_id')&&p.get('client_id')!==CLIENT_ID)return oauthError(401,'invalid_client','Unknown client');
 let sub;
 if(grant==='authorization_code'){
  const code=open('code',p.get('code'),{env,now:t});
  if(!code||code.redirect_uri!==p.get('redirect_uri')||!p.get('code_verifier')||!same(pkce(p.get('code_verifier')),code.code_challenge))return oauthError(400,'invalid_grant','Invalid or expired code');
  if(!(await markUsed(code.jti,code.exp)))return oauthError(400,'invalid_grant','Code already used');
  sub=code.sub;
 }else if(grant==='refresh_token'){
  const r=open('refresh',p.get('refresh_token'),{env,now:t});if(!r)return oauthError(400,'invalid_grant','Invalid or expired refresh token');
  sub=r.sub;
 }else return oauthError(400,'unsupported_grant_type','Unsupported grant type');
 let current;try{current=await loadPolicy();}catch{return oauthError(503,'temporarily_unavailable','Access check unavailable');}
 if(!isSchoolAdmin(current.data,sub))return oauthError(400,'invalid_grant','Access has been removed');
 return tokens(sub,{env,now:t});
};}

// Bearer check for /mcp. Returns {kerberos} or a 401 Response with the discovery hint.
export async function authenticate(request,{loadPolicy=policy.loadPolicy,env=process.env,now=()=>Date.now()}={}){
 const o=origin(env),challenge=(err)=>new Response(JSON.stringify({error:err||'unauthorized'}),{status:401,headers:{'Content-Type':'application/json',...noStore,'WWW-Authenticate':`Bearer resource_metadata="${o}/.well-known/oauth-protected-resource"${err?`, error="${err}"`:''}`}});
 const m=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'');
 if(!m)return {response:challenge()};
 const tok=open('access',m[1],{env,now:now()});if(!tok)return {response:challenge('invalid_token')};
 let current;try{current=await loadPolicy();}catch{return {response:json(503,{error:'Access check unavailable'})};}
 if(!isSchoolAdmin(current.data,tok.sub))return {response:new Response(JSON.stringify({error:'insufficient_scope'}),{status:403,headers:{'Content-Type':'application/json',...noStore}})};
 return {kerberos:tok.sub};
}

export async function blobMarkUsed(jti,exp){
 const {getStore}=await import('@netlify/blobs');
 const store=getStore({name:'mitsoeservices-mcp-'+policy.deploymentName(),consistency:'strong'});
 const r=await store.setJSON('code/'+jti,{exp},{onlyIfNew:true});return r?.modified!==false;
}
