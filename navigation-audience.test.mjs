import test from 'node:test';
import assert from 'node:assert/strict';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {pageAudience,audienceHtml} from './src/audience.cjs';
import {mainNavigation} from './src/navigation.cjs';
import {createServiceHubHandler} from './src/service-hub.mjs';
import {createDashboardHandler} from './src/dashboard.mjs';
import {createUnitHandler} from './src/unit-page.mjs';
function state(){const data=policy.initialPolicy();for(const [username,scope,role] of [['limited_reader','aeroastro','limited_read'],['limited_writer','aeroastro','limited_write'],['reader','aeroastro','read'],['writer','aeroastro','write'],['unit_admin','aeroastro','admin'],['other_unit_person','be','admin'],['school_limited','school','limited_read'],['school_reader','school','read'],['school_writer','school','write']])data.grants.push({username,scope,role});return data;}
const authorize=(data,user)=>(event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:user}),load:async()=>({data,etag:'test'})});
test('visible audience matches actual authorization for every user and content tier',async()=>{
 const data=state();for(const tier of ['full','limited']){
  const listed=pageAudience(data,'aeroastro',tier).map(p=>p.username);
  for(const username of [...new Set(data.grants.map(g=>g.username))])assert.equal(listed.includes(username),Boolean((await authorize(data,username)({},{scope:'aeroastro',audience:tier})).user));
  assert.ok(!listed.includes('other_unit_person'));assert.ok(listed.includes('oconaill'));assert.ok(listed.includes('juliekuk'));assert.equal(listed.includes('school_limited'),tier==='limited');
 }
 const removed={...data,grants:data.grants.filter(g=>g.username!=='reader')};assert.ok(!pageAudience(removed,'aeroastro','full').some(p=>p.username==='reader'));
});
test('unit pages show audience under heading, include inherited access, and report to both school contacts',async()=>{
 const data=state(),handler=createUnitHandler(authorize(data,'unit_admin'));
 for(const section of ['full','limited']){
  const page=await handler({httpMethod:'GET',path:'/units/aeroastro/'+section});assert.equal(page.statusCode,200);
  assert.ok(page.body.indexOf('Who can view this page')>page.body.indexOf('<h1>'));assert.ok(page.body.includes('includes school-wide access'));
  assert.ok(page.body.includes('mailto:oconaill@mit.edu,juliekuk@mit.edu?subject=URGENT'));assert.ok(!page.body.includes('other_unit_person'));
  assert.equal(page.body.includes('limited_reader@mit.edu'),section==='limited');
 }
 const incomplete=await createUnitHandler(async()=>({user:{},role:'read'}))({httpMethod:'GET',path:'/units/aeroastro/full'});assert.equal(incomplete.statusCode,503);
});
test('primary navigation has requested hierarchy and shows access management only for administrators',()=>{
 const expected=['Services Home','Academic units','Other units','SoE HQ'];for(const label of expected)assert.ok(mainNavigation({schoolAccess:true}).includes('>'+label+'</a>'));
 assert.ok(!mainNavigation().includes('Nimbus Search'));assert.ok(!mainNavigation({manage:true}).includes('Nimbus Search'));assert.ok(mainNavigation({schoolAdmin:true}).includes('Nimbus Search'));
 assert.ok(!mainNavigation().includes('Manage access'));assert.ok(mainNavigation({manage:true}).includes('Manage access'));
 assert.ok(!mainNavigation().includes('/soe-wallet'));assert.ok(!mainNavigation().includes('/reports'));
});
test('HQ and budget pages enforce school access and Nimbus requires school-wide administration',async()=>{
 const data=state(),paths=['/soe-hq','/soe-hq/balance-sheet','/soe-hq/budget-explorer','/soe-hq/budget-submissions','/soe-hq/budget-submissions/fy27','/soe-hq/budget-submissions/fy28'];
 for(const path of paths){assert.equal((await createServiceHubHandler(authorize(data,'unit_admin'))({httpMethod:'GET',path})).statusCode,403);assert.equal((await createServiceHubHandler(authorize(data,'oconaill'))({httpMethod:'GET',path})).statusCode,200);}
 const hq=await createServiceHubHandler(authorize(data,'oconaill'))({httpMethod:'GET',path:'/soe-hq'});for(const label of ['Dean’s Discretionary','All SoE-controlled accounts','SoE Wallet','SoE Balance Sheet','Budget Submissions'])assert.ok(hq.body.includes('<h2>'+label+'</h2>'));
 const explorer=await createServiceHubHandler(authorize(data,'oconaill'))({httpMethod:'GET',path:'/soe-hq/budget-explorer'});assert.match(explorer.body,/budget-explorer\.js/);assert.match(explorer.body,/Unit history/);assert.match(explorer.body,/Compare units in a year/);
 assert.equal((await createServiceHubHandler(authorize(data,'limited_reader'))({httpMethod:'GET',path:'/nimbus'})).statusCode,403);
 assert.equal((await createServiceHubHandler()({httpMethod:'GET',path:'/soe-hq/budget-submissions/fy29'})).statusCode,404);
 for(const username of ['limited_reader','unit_admin','other_unit_person','school_limited','school_reader','school_writer','oconaill','juliekuk']){const result=await createServiceHubHandler(authorize(data,username))({httpMethod:'GET',path:'/nimbus'});assert.equal(result.statusCode,['oconaill','juliekuk'].includes(username)?200:403);if(result.statusCode===403)assert.ok(!result.body.includes('pageID=3'));const direct=await createServiceHubHandler(authorize(data,username))({httpMethod:'GET',path:'/.netlify/functions/service-hub',queryStringParameters:{page:'/nimbus'}});assert.equal(direct.statusCode,result.statusCode);const homePage=await createDashboardHandler(authorize(data,username))({httpMethod:'GET',queryStringParameters:{home:'1'}});assert.equal(homePage.body.includes('Nimbus Search'),['oconaill','juliekuk'].includes(username));}
 const home=await createDashboardHandler(authorize(data,'limited_reader'))({httpMethod:'GET',queryStringParameters:{home:'1'}});assert.equal(home.statusCode,200);assert.ok(!home.body.includes('Manage access'));assert.ok(!home.body.includes('Nimbus Search'));
 const adminHome=await createDashboardHandler(authorize(data,'oconaill'))({httpMethod:'GET',queryStringParameters:{home:'1'}});assert.ok(adminHome.body.includes('Nimbus Search'));
});
