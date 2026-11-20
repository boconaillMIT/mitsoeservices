const {AsyncLocalStorage}=require('node:async_hooks');
const deployment=new AsyncLocalStorage();
function withPolicyContext(context,callback){return deployment.run(context?.deploy||{},callback);}
function deploymentName(){return deployment.getStore()?.published===true?'production':'preview';}
const ADMINS=Object.freeze(['oconaill','juliekuk']);
const PROTECTED_ADMINS=Object.freeze(['oconaill']);
const INITIAL_USERS=ADMINS;
const {ALL_UNITS:UNITS}=require('./units.cjs');
const {BUDGET_SCOPES}=require('./budget-scopes.cjs');
const SCOPES=Object.freeze({school:'All School of Engineering',rct:'RCT reviews (separate access)',...Object.fromEntries(Object.entries(UNITS).map(([key,u])=>[key,u.name])),...BUDGET_SCOPES});
const ROLES=Object.freeze({limited_read:1,limited_write:2,read:3,write:4,admin:5});
const CAPABILITIES=Object.freeze({limited_read:1,limited_write:2,read:1,write:2,admin:3});
function roleLabels(scope){if(Object.hasOwn(BUDGET_SCOPES,scope))return {read:'Budget viewer (read-only, selected department)'};if(scope==='rct')return {read:'Read',write:'Write',admin:'Manager'};const wide=scope==='school'?'school-wide':'unit-wide';return {limited_read:'Read-only (limited)',limited_write:'Write (limited)',read:'Read-only ('+wide+')',write:'Write ('+wide+')',admin:'Administrator ('+wide+')'};}
const KEY='access-policy';
function normalizeLogin(v){if(typeof v!=='string')return null;const s=v.trim().toLowerCase().replace(/@mit\.edu$/,'');return /^[a-z][a-z0-9._-]{0,63}$/.test(s)?s:null;}
function validUsername(v){return typeof v==='string'&&normalizeLogin(v)===v;}
function initialPolicy(){return {schema:2,users:[...ADMINS],grants:ADMINS.map(username=>({username,scope:'school',role:'admin'})),audit:[]};}
function effectiveRole(data,username,scope='school',audience='full'){
 if(!Array.isArray(data?.grants)||!Object.hasOwn(SCOPES,scope))return null;
 return data.grants.filter(g=>g.username===username&&(g.scope===scope||g.scope==='school'&&(scope!=='rct'||g.role==='admin'))&&(audience==='limited'||!g.role.startsWith('limited_'))).reduce((best,g)=>(CAPABILITIES[g.role]||0)>(CAPABILITIES[best]||0)||CAPABILITIES[g.role]===CAPABILITIES[best]&&(ROLES[g.role]||0)>(ROLES[best]||0)?g.role:best,null);
}
function managedScopes(data,actor){return effectiveRole(data,actor,'school')==='admin'?Object.keys(SCOPES):['rct',...Object.keys(UNITS)].filter(scope=>effectiveRole(data,actor,scope)==='admin');}
function validatePolicy(data){
 if(!data||data.schema!==2||!Array.isArray(data.grants)||!Array.isArray(data.audit)||data.grants.length>1500)throw Error('Invalid access policy');
 const seen=new Set();
 for(const g of data.grants){if(!validUsername(g.username)||!Object.hasOwn(SCOPES,g.scope)||!Object.hasOwn(roleLabels(g.scope),g.role)||seen.has(g.username+':'+g.scope))throw Error('Invalid grant');seen.add(g.username+':'+g.scope);}
 if(PROTECTED_ADMINS.some(u=>effectiveRole(data,u)!=='admin'))throw Error('Recovery administrator missing');
 data.users=[...new Set(data.grants.map(g=>g.username))].sort();return data;
}
async function getPolicyStore(){const {getStore}=await import('@netlify/blobs');const context=deployment.getStore()?.published===true?'production':'preview';return getStore({name:'mitsoeservices-access-'+context,consistency:'strong'});}
async function loadPolicy(store){
 store||=await getPolicyStore();let entry=await store.getWithMetadata(KEY,{type:'json'});
 if(!entry){await store.setJSON(KEY,initialPolicy(),{onlyIfNew:true});entry=await store.getWithMetadata(KEY,{type:'json'});}
 if(!entry?.etag)throw Error('Access policy unavailable');
 if(entry.data?.schema!==2){
  if(entry.data?.schema!==undefined||!Array.isArray(entry.data?.users)||!Array.isArray(entry.data?.audit))throw Error('Invalid legacy policy');
  const data=initialPolicy();data.audit=[...entry.data.audit,{actor:'system',action:'pilot-reset',username:'',at:new Date().toISOString()}].slice(-200);
  await store.setJSON(KEY,data,{onlyIfMatch:entry.etag});entry=await store.getWithMetadata(KEY,{type:'json'});
 }
 return {data:validatePolicy(entry.data),etag:entry.etag};
}
async function changePolicy(actor,action,username,expectedEtag,store,{scope='school',role='read'}={}){
 store||=await getPolicyStore();const current=await loadPolicy(store);
 if(!managedScopes(current.data,actor).includes(scope))return {status:403,error:'Administrator access to the selected unit is required.'};
 username=normalizeLogin(username);
 if(!['add','remove'].includes(action)||!validUsername(username)||!Object.hasOwn(SCOPES,scope)||!Object.hasOwn(roleLabels(scope),role)||typeof expectedEtag!=='string'||!expectedEtag)return {status:400,error:'Choose a valid username, scope, and access level.'};
 if(PROTECTED_ADMINS.includes(username))return {status:400,error:'The recovery administrator cannot be changed here.'};
 if(current.etag!==expectedEtag)return {status:409,error:'Access list changed. Refresh and try again.'};
 const previousRole=current.data.grants.find(g=>g.username===username&&g.scope===scope)?.role;
 const grants=current.data.grants.filter(g=>!(g.username===username&&g.scope===scope));if(action==='add')grants.push({username,scope,role});
 if(grants.length>1500)return {status:400,error:'Access list limit reached.'};
 const data=validatePolicy({schema:2,grants,audit:[...current.data.audit,{actor,action,username,scope,role:action==='add'?role:undefined,previous_role:previousRole,at:new Date().toISOString()}].slice(-200)});
 const written=await store.setJSON(KEY,data,{onlyIfMatch:expectedEtag});if(!written.modified)return {status:409,error:'Access list changed. Refresh and try again.'};
 const saved=await loadPolicy(store);if(JSON.stringify(saved.data.grants)!==JSON.stringify(data.grants))return {status:409,error:'Access changed again. Refresh to check the current state.'};return {status:200,...saved};
}
module.exports={ADMINS,PROTECTED_ADMINS,INITIAL_USERS,SCOPES,ROLES,CAPABILITIES,roleLabels,managedScopes,normalizeLogin,validUsername,initialPolicy,validatePolicy,effectiveRole,loadPolicy,changePolicy,withPolicyContext,deploymentName};
