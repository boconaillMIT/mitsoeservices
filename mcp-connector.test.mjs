import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAuthorize,createToken,authenticate,register,serverMetadata,resourceMetadata,seal,open,CLIENT_ID} from './src/mcp-auth.mjs';
import {createMcpHandler,summarize,TOOLS} from './src/mcp-server.mjs';

const env={APP_ORIGIN:'https://mitsoeservices.netlify.app',SESSION_SECRET:'x'.repeat(40)};
const O=env.APP_ORIGIN,CB='https://claude.ai/api/mcp/auth_callback';
const policyWith=(...admins)=>async()=>({data:{grants:admins.map(username=>({username,scope:'school',role:'admin'})).concat([{username:'reader',scope:'school',role:'read'}])}});
const verifier='v'.repeat(50),challenge=createHash('sha256').update(verifier).digest('base64url');
const authUrl=(extra={})=>O+'/mcp-oauth/authorize?'+new URLSearchParams({client_id:CLIENT_ID,redirect_uri:CB,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',state:'s1',...extra});
const used=new Set(),markUsed=async jti=>used.has(jti)?false:(used.add(jti),true);

test('discovery metadata points Claude at this site',async()=>{
 const r=await (resourceMetadata(env)).json();assert.equal(r.resource,O+'/mcp');assert.deepEqual(r.authorization_servers,[O]);
 const s=await (serverMetadata(env)).json();assert.equal(s.token_endpoint,O+'/mcp-oauth/token');assert.deepEqual(s.code_challenge_methods_supported,['S256']);
});
test('registration only accepts Claude callbacks',async()=>{
 const bad=await register(new Request(O,{method:'POST',body:JSON.stringify({redirect_uris:['https://evil.example/cb']})}));assert.equal(bad.status,400);
 const good=await register(new Request(O,{method:'POST',body:JSON.stringify({redirect_uris:[CB]})}));assert.equal(good.status,201);assert.equal((await good.json()).client_id,CLIENT_ID);
});
test('authorize sends signed-out users to MIT sign-in and back',async()=>{
 const h=createAuthorize({readSession:async()=>null,loadPolicy:policyWith('oconaill'),markUsed,env});
 const r=await h(new Request(authUrl()));assert.equal(r.status,302);
 const loc=new URL(r.headers.get('location'),O);assert.equal(loc.pathname,'/.netlify/functions/auth-login');assert.match(loc.searchParams.get('returnTo'),/^\/mcp-oauth\/authorize\?/);
});
test('authorize rejects foreign redirect URIs without redirecting',async()=>{
 const h=createAuthorize({readSession:async()=>({kerberos:'oconaill'}),loadPolicy:policyWith('oconaill'),markUsed,env});
 const r=await h(new Request(authUrl({redirect_uri:'https://evil.example/cb'})));assert.equal(r.status,400);assert.equal(r.headers.get('location'),null);
});
test('non-administrators are refused',async()=>{
 const h=createAuthorize({readSession:async()=>({kerberos:'reader'}),loadPolicy:policyWith('oconaill'),markUsed,env});
 const r=await h(new Request(authUrl()));assert.equal(new URL(r.headers.get('location')).searchParams.get('error'),'access_denied');
});
test('consent requires a same-origin POST, then code → tokens → MCP call works once',async()=>{
 const h=createAuthorize({readSession:async()=>({kerberos:'oconaill'}),loadPolicy:policyWith('oconaill'),markUsed,env});
 const consent=await h(new Request(authUrl()));assert.equal(consent.status,200);assert.match(await consent.text(),/oconaill@mit\.edu/);
 const form=new URLSearchParams([...new URL(authUrl()).searchParams,['decision','allow']]);
 const cross=await h(new Request(O+'/mcp-oauth/authorize',{method:'POST',headers:{origin:'https://evil.example'},body:form}));assert.equal(cross.status,403);
 const r=await h(new Request(O+'/mcp-oauth/authorize',{method:'POST',headers:{origin:O,'content-type':'application/x-www-form-urlencoded'},body:form}));
 const back=new URL(r.headers.get('location'));assert.equal(back.origin+back.pathname,CB);assert.equal(back.searchParams.get('state'),'s1');
 const code=back.searchParams.get('code');assert.ok(code);
 const tok=createToken({loadPolicy:policyWith('oconaill'),markUsed,env});
 const wrongPkce=await tok(new Request(O,{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:CB,code_verifier:'w'.repeat(50)})}));assert.equal(wrongPkce.status,400);
 const t=await tok(new Request(O,{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:CB,code_verifier:verifier,client_id:CLIENT_ID})}));assert.equal(t.status,200);
 const body=await t.json();assert.equal(body.token_type,'Bearer');
 const again=await tok(new Request(O,{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:CB,code_verifier:verifier})}));assert.equal(again.status,400,'codes are single-use');
 const refreshed=await tok(new Request(O,{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:body.refresh_token})}));assert.equal(refreshed.status,200);
 const revoked=await createToken({loadPolicy:policyWith('someoneelse'),markUsed,env})(new Request(O,{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:body.refresh_token})}));assert.equal(revoked.status,400,'refresh stops once admin access is removed');
 const who=await authenticate(new Request(O+'/mcp',{headers:{authorization:'Bearer '+body.access_token}}),{loadPolicy:policyWith('oconaill'),env});assert.equal(who.kerberos,'oconaill');
});
test('bearer checks: missing, forged, wrong kind, expired, revoked',async()=>{
 const lp=policyWith('oconaill');
 let r=await authenticate(new Request(O+'/mcp'),{loadPolicy:lp,env});assert.equal(r.response.status,401);assert.match(r.response.headers.get('www-authenticate'),/resource_metadata=/);
 r=await authenticate(new Request(O+'/mcp',{headers:{authorization:'Bearer abc.def.ghi'}}),{loadPolicy:lp,env});assert.equal(r.response.status,401);
 const refresh=seal('refresh',{sub:'oconaill'},{env});r=await authenticate(new Request(O+'/mcp',{headers:{authorization:'Bearer '+refresh}}),{loadPolicy:lp,env});assert.equal(r.response.status,401,'refresh tokens are not access tokens');
 const old=seal('access',{sub:'oconaill'},{env,now:Date.now()-2*3600e3});r=await authenticate(new Request(O+'/mcp',{headers:{authorization:'Bearer '+old}}),{loadPolicy:lp,env});assert.equal(r.response.status,401);
 const other=seal('access',{sub:'oconaill'},{env:{...env,SESSION_SECRET:'y'.repeat(40)}});assert.equal(open('access',other,{env}),null);
 const ok=seal('access',{sub:'oconaill'},{env});r=await authenticate(new Request(O+'/mcp',{headers:{authorization:'Bearer '+ok}}),{loadPolicy:policyWith('nobody'),env});assert.equal(r.response.status,403);
});

const fakeLoad=async()=>({selected:[{id:6,label:'Budget Fiscal Year'},{id:7,label:'Department'},{id:8,label:'Original Request Description'},{id:9,label:'Request Amount'},{id:10,label:'Provost Non-recurring (non-base) - Approved'}],
 raw:[{3:{value:1},6:{value:'2027'},7:{value:'EECS'},8:{value:'TA support'},9:{value:100},10:{value:40}},{3:{value:2},6:{value:'2028'},7:{value:'EECS'},8:{value:'Lab staff'},9:{value:250}},{3:{value:3},6:{value:'2028'},7:{value:'DMSE'},8:{value:'TA support'},9:{value:50},10:{value:null}}]});
const call=async(h,msg)=>{const r=await h(new Request(O+'/mcp',{method:'POST',body:JSON.stringify(msg)}));return r.status===202?null:r.json();};
test('MCP server: unauthenticated requests get the auth challenge and no data',async()=>{
 let loaded=false;const h=createMcpHandler({auth:a=>authenticate(a,{loadPolicy:policyWith('oconaill'),env}),load:async()=>{loaded=true;return fakeLoad();}});
 const r=await h(new Request(O+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_budget_requests'}})}));assert.equal(r.status,401);assert.equal(loaded,false);
});
test('MCP server: initialize, list tools, filter and summarize',async()=>{
 const h=createMcpHandler({auth:async()=>({kerberos:'oconaill'}),load:fakeLoad,log:()=>{}});
 const init=await call(h,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}}});assert.equal(init.result.protocolVersion,'2025-06-18');
 assert.equal(await call(h,{jsonrpc:'2.0',method:'notifications/initialized'}),null);
 const list=await call(h,{jsonrpc:'2.0',id:2,method:'tools/list'});assert.deepEqual(list.result.tools.map(t=>t.name),TOOLS.map(t=>t.name));assert.ok(list.result.tools.every(t=>t.annotations.readOnlyHint));
 const r=await call(h,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'list_budget_requests',arguments:{fiscal_year:2028,department:'eecs'}}});
 assert.equal(r.result.structuredContent.matched,1);assert.equal(r.result.structuredContent.records[0]['Original Request Description'],'Lab staff');assert.equal(r.result.structuredContent.records[0].record_id,2);
 const s=await call(h,{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'summarize_budget_requests',arguments:{search:'TA support',group_by:'fiscal_year'}}});
 const g=s.result.structuredContent.groups;assert.deepEqual(g.map(x=>[x.fiscal_year,x.records,x.requested.total]),[[2027,1,100],[2028,1,50]]);assert.deepEqual(g[1].provost_one_time,{total:0,recorded:0});
 const bad=await call(h,{jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'list_budget_requests',arguments:{limit:100000}}});assert.equal(bad.result.isError,true);
 const unknown=await call(h,{jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'update_record',arguments:{}}});assert.equal(unknown.error.code,-32602);
 assert.equal((await h(new Request(O+'/mcp'))).status,405);
});
test('summaries group by department',()=>{assert.deepEqual(summarize([{Department:'A','Request Amount':'5'},{Department:'A','Request Amount':3},{Department:'B'}],'department').map(g=>[g.department,g.requested.total,g.requested.recorded]),[['A',8,2],['B',0,0]]);});
