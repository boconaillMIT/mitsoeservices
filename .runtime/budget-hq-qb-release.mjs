// SoE HQ Budget: decisions, Dean's briefing and documents links stored in QuickBase (no site storage).
// Run from the netlify-space folder after `git pull`:  node .runtime/budget-hq-qb-release.mjs
// Guards: tests first; draft must keep exactly the existing functions;
// other public files unchanged; production checks; automatic rollback on failure.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createHash,randomBytes} from 'node:crypto';
const siteId='d5648481-35ee-4894-913c-348262857b35',origin='https://mitsoeservices.netlify.app',changed=['budget-hq.js','budget-hq.css'];
const cfg=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'netlify/Config/config.json'),'utf8')),token=cfg.users[cfg.userId]?.auth?.token;if(!token)throw Error('Netlify login unavailable. Run: npx netlify login');
const redact=s=>String(s).split(token).join('[redacted]');
// Retry transient network errors (connection resets, timeouts, 5xx) before giving up.
async function retry(label,fn){let last;for(let i=0;i<5;i++){try{return await fn();}catch(e){last=e;if(e.permanent)throw e;console.log('  (network retry '+(i+1)+'/4 for '+label+': '+(e.cause?.code||e.message)+')');await new Promise(r=>setTimeout(r,3000*(i+1)));}}throw last;}
async function api(p,body){return retry(p.split('?')[0],()=>apiOnce(p,body));}
async function apiOnce(p,body){const r=await fetch('https://api.netlify.com/api/v1/'+p,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Object.assign(Error('Netlify request failed: '+r.status+' '+p.split('?')[0]),{permanent:r.status<500&&r.status!==429});return r.json();}
const sha=b=>createHash('sha1').update(b).digest('hex'),step=m=>console.log('• '+m);

// Local checks first
for(const name of changed)assert(fs.existsSync(path.join('public',name)),'Missing public/'+name);
let t=spawnSync(process.execPath,['--test','budget-hq.test.mjs','reserves.test.mjs','mcp-connector.test.mjs','budget-explorer.test.mjs','navigation-audience.test.mjs'],{encoding:'utf8',windowsHide:true});if(t.status!==0){console.error(t.stdout);throw Error('Budget section tests failed; nothing was deployed.');}
step('Budget section, reserves, connector and explorer tests passed');
const ADDED=[];
for(const f of ADDED)assert(fs.existsSync(path.join('netlify/functions',f+'.mjs')),'Missing netlify/functions/'+f+'.mjs. Run git pull first.');

// 1. Prepare release folder from current production
const site=await api('sites/'+siteId),previous=site.published_deploy.id;step('Current production deploy: '+previous);
const assets=await api('sites/'+siteId+'/files'),dir=path.resolve('.runtime','budget-hq-qb-release-'+randomBytes(6).toString('hex'));fs.mkdirSync(dir);
let copied=0;
for(const a of assets){if(a.path==='/netlify.toml')continue;const rel=a.path.replace(/^\//,'');assert(rel&&!rel.split('/').includes('..')&&!path.isAbsolute(rel),'Invalid asset path');const dest=path.resolve(dir,rel);assert(dest.startsWith(dir+path.sep));
 if(changed.includes(rel))continue;
 let content;const local=path.resolve('public',rel);if(fs.existsSync(local)){const b=fs.readFileSync(local);if(sha(b)===a.sha)content=b;}
 if(!content){content=await retry(a.path,async()=>{const r=await fetch(origin+a.path,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Unable to copy existing public file '+a.path);return Buffer.from(await r.arrayBuffer());});assert.equal(sha(content),a.sha,'Existing file mismatch: '+a.path);}
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content,{flag:'wx'});copied++;}
for(const name of changed)fs.copyFileSync(path.join('public',name),path.join(dir,name),fs.constants.COPYFILE_EXCL);
step(`Prepared ${copied} unchanged public files + ${changed.length} budget files`);

// 2. Draft deploy and verification
const cli=path.resolve('node_modules/netlify-cli/bin/run.js');
step('Uploading draft (packaging functions can take several minutes)…');
let proc=spawnSync(process.execPath,[cli,'deploy','--site',siteId,'--dir',dir,'--functions','netlify/functions','--no-build','--skip-functions-cache','--json','--message','Budget HQ on QuickBase (draft)'],{encoding:'utf8',timeout:1200000,maxBuffer:20000000,windowsHide:true,stdio:['ignore','pipe','inherit']});
if(proc.status!==0)throw Error('Draft deploy failed: '+redact(proc.error||proc.stdout||'see messages above').slice(0,1200));
const draftId=JSON.parse(proc.stdout).deploy_id;assert(draftId,'No draft deploy ID returned.');
let draft=await api('deploys/'+draftId);for(let i=0;i<30&&draft.state!=='ready';i++){if(draft.state==='error')throw Error('Draft failed to build.');await new Promise(r=>setTimeout(r,2000));draft=await api('deploys/'+draftId);}
assert.equal(draft.state,'ready','Draft not ready.');
assert.equal((await api('sites/'+siteId)).published_deploy.id,previous,'Production changed while staging; stop and recheck.');
const live=await api('deploys/'+previous),fnLive=live.available_functions.map(f=>f.n).sort(),fnDraft=draft.available_functions.map(f=>f.n).sort();
const fnExpected=[...new Set([...fnLive,...ADDED])].sort();
assert.deepEqual(fnDraft,fnExpected,'The draft would drop or add an unexpected backend function. Nothing was published.');
for(const a of assets){if(a.path==='/netlify.toml'||changed.includes(a.path.slice(1)))continue;const f=await api('deploys/'+draftId+'/files/'+a.path.slice(1));assert.equal(f.sha,a.sha,'Existing public file would change: '+a.path);}
for(const name of changed){const f=await api('deploys/'+draftId+'/files/'+name);assert.equal(f.sha,sha(fs.readFileSync(path.join(dir,name))),'Budget file mismatch: '+name);}
step(`Draft ${draftId} verified: ${fnLive.length} existing functions kept, no functions added or removed, other public files unchanged`);

// 3. Publish the verified draft, verify, roll back on failure
async function verify(){
 const get=p=>fetch(origin+p,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
 let r=await get('/soe-hq/budget-explorer');assert.equal(r.status,302,'Budget page sign-in check failed');assert.match(r.headers.get('location')||'',/auth-login/);
 r=await get('/soe-hq/budget-explorer-legacy');assert.equal(r.status,302,'Legacy budget page sign-in check failed');assert.match(r.headers.get('location')||'',/budget-explorer-legacy/);
 r=await get('/.netlify/functions/budget-explorer');assert.equal(r.status,401,'Budget API protection check failed');
 for(const p of ['/soe-hq/budget','/soe-hq/budget/fy28','/soe-hq/budget/fy28/eecs']){r=await get(p);assert.equal(r.status,302,'Budget page sign-in check failed: '+p);assert.match(r.headers.get('location')||'',/auth-login/);}
 r=await get('/.netlify/functions/budget-hq-data?cycle=fy28');assert.equal(r.status,401,'Budget decisions data must require sign-in');
 r=await get('/soe-hq/reserves');assert.equal(r.status,302,'Reserves page sign-in check failed');assert.match(r.headers.get('location')||'',/auth-login/);
 r=await get('/.netlify/functions/reserves-data');assert.equal(r.status,401,'Reserves data protection check failed');
 r=await get('/soe-wallet');assert.equal(r.status,302,'Wallet page sign-in check failed');
 r=await get('/.netlify/functions/wallet-categories?unit=school');assert.equal(r.status,401,'Wallet API protection check failed');
 r=await get('/.netlify/functions/auth-login?returnTo=%2Fsoe-hq%2Fbudget-explorer');assert.equal(r.status,302,'MIT sign-in check failed');assert.equal(new URL(r.headers.get('location')).hostname,'mitprod.okta.com');
 r=await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),redirect:'manual',signal:AbortSignal.timeout(20000)});assert.equal(r.status,401,'Connector must refuse requests without a token');assert.match(r.headers.get('www-authenticate')||'',/resource_metadata="https:\/\/mitsoeservices\.netlify\.app\/\.well-known\/oauth-protected-resource"/);
 r=await get('/.well-known/oauth-protected-resource');assert.equal(r.status,200,'Connector resource metadata unavailable');assert.equal((await r.json()).resource,origin+'/mcp');
 r=await get('/.well-known/oauth-authorization-server');assert.equal(r.status,200,'Connector sign-in metadata unavailable');assert.equal((await r.json()).authorization_endpoint,origin+'/mcp-oauth/authorize');
 r=await fetch(origin+'/mcp-oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['https://example.com/cb']}),redirect:'manual',signal:AbortSignal.timeout(20000)});assert.equal(r.status,400,'Connector must reject non-Claude callbacks');
 r=await get('/mcp-oauth/authorize?client_id=mitsoeservices-claude&redirect_uri=https%3A%2F%2Fexample.com%2Fcb&response_type=code');assert.equal(r.status,400,'Connector sign-in must reject foreign redirects');assert.equal(r.headers.get('location'),null);
 for(const name of changed){r=await get('/'+name);assert.equal(r.status,200,name+' unavailable');assert.equal(sha(Buffer.from(await r.arrayBuffer())),sha(fs.readFileSync(path.join(dir,name))),'Live file differs: '+name);}
}
// A draft is built without production-only settings (MIT sign-in, QuickBase keys), so it cannot be promoted as-is.
// Publish a fresh production build of the same verified folder and functions instead.
let releaseId=null;
try{
 step('Publishing production build (several minutes)…');
 proc=spawnSync(process.execPath,[cli,'deploy','--site',siteId,'--prod','--dir',dir,'--functions','netlify/functions','--no-build','--skip-functions-cache','--json','--message','Budget HQ: decisions, briefing and documents links in QuickBase'],{encoding:'utf8',timeout:1200000,maxBuffer:20000000,windowsHide:true,stdio:['ignore','pipe','inherit']});
 if(proc.status!==0)throw Error('Production deploy failed: '+redact(proc.error||proc.stdout||'see messages above').slice(0,1200));
 releaseId=JSON.parse(proc.stdout).deploy_id;assert(releaseId,'No production deploy ID returned.');step('Published '+releaseId+' to production; checking…');
 const rel=await api('deploys/'+releaseId);assert.deepEqual(rel.available_functions.map(f=>f.n).sort(),fnExpected,'Production build function list differs from the verified draft.');
 let problem;for(let i=0;i<8;i++){try{assert.equal((await api('sites/'+siteId)).published_deploy.id,releaseId,'Release did not become current.');await verify();problem=null;break;}catch(e){problem=e;await new Promise(r=>setTimeout(r,2500));}}
 if(problem)throw problem;
 const receipt={published:releaseId,verifiedDraft:draftId,previous,functions:fnDraft.length,added:ADDED,publicFilesPreserved:copied,changed};fs.writeFileSync('.runtime/budget-hq-qb-receipt.json',JSON.stringify(receipt,null,2));
 step('Live and verified: '+origin+'/soe-hq/budget   Previous deploy (for manual rollback): '+previous);console.log(JSON.stringify(receipt));
}catch(error){
 try{const now=(await api('sites/'+siteId)).published_deploy.id;if(now===previous)console.error('Previous working deployment remains live.');else{await api('sites/'+siteId+'/deploys/'+previous+'/restore',{});console.error('Check failed; restored the previous working deployment '+previous+'.');}}catch{console.error('Could not verify or restore production automatically. Restore '+previous+' in the Netlify dashboard.');}
 throw error;
}
