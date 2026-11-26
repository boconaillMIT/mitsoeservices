import authorizations from './authorization-summary.cjs';
import {readFile} from 'node:fs/promises';

import {join} from 'node:path';

import access from './access.cjs';

import policy from './policy.cjs';
import units from './units.cjs';
import navigation from './navigation.cjs';
import {accessibleUnits,unitCards} from './unit-cards.mjs';
import {hubLayout} from './unit-hub.mjs';

export function createDashboardHandler(authorize=access.authorize){return async event=>{

 if(event.httpMethod!=='GET')return {statusCode:405,headers:access.noStore,body:'GET required'};

 let result=await authorize(event,{scope:'any',audience:'limited'});
 if(result.statusCode===403)result=await authorize(event,{scope:'dr-requester'});

 const headers={...access.noStore,'Content-Type':'text/html; charset=utf-8'};

 if(result.statusCode===401)return {statusCode:200,headers,body:await readFile(join(process.cwd(),'src/login.html'),'utf8')};

 if(!result.user)return result;

 const personal=authorizations.authorizationsHtml(result.policy?.data,result.kerberos);
 if(event.path==='/my-authorizations'||event.queryStringParameters?.authorizations==='1')return {statusCode:200,headers,body:hubLayout('My authorizations',personal,result.canManage,'',result.admin,result.schoolAccess,result.navigation)};
 const authorizationCard=authorizations.authorizationsHtml(result.policy?.data,result.kerberos,{compact:true});
 const drCard='<section class="card"><h2>Donation Requests</h2><p>Request support for your team or organization and track its review.</p><a class="desktop" href="/donation-requests">Open Donation Requests →</a></section>';
 const rctCard=result.navigation?.rct?'<section class="card"><h2>RCT review</h2><p>Review research continuity proposals, grades and funding plans.</p><a class="desktop" href="/soe-hq/rct-review">Open RCT review</a></section>':'';
 const budgetCard=result.navigation?.budget&&!result.schoolAccess?'<section class="card"><h2>My department budgets</h2><p>Read-only submissions, requests, history and briefing notes for your assigned departments.</p><a class="desktop" href="/soe-hq/budget">Open department budgets →</a></section>':'';
 const allowed=accessibleUnits(result);
 if(allowed.length>0&&allowed.length<=3){
  const management=result.canManage?'<section class="card"><h2>Manage access</h2><p>Manage permissions within your authorized units.</p><a class="desktop" href="/admin">Manage access →</a></section>':'';
  return {statusCode:200,headers,body:hubLayout('Your units','<div class="unit-directory">'+authorizationCard+unitCards(result)+rctCard+drCard+budgetCard+management+'</div>',result.canManage,'',result.admin,result.schoolAccess,{...result.navigation,compactUnits:true})};
 }

 return {statusCode:200,headers,body:(await readFile(join(process.cwd(),'src/dashboard.html'),'utf8')).replace('<!--MAIN-NAV-->',navigation.mainNavigation({manage:result.canManage,schoolAdmin:result.admin,schoolAccess:result.schoolAccess,visibility:result.navigation,active:'home'})).replace(/<section class="card"><h2>Academic units<\/h2>.*?<\/section>/,result.navigation?.academic?'$&':'').replace(/<section class="card"><h2>Other units<\/h2>.*?<\/section>/,result.navigation?.other?'$&':'').replace(/<section class="card"><h2>SoE HQ<\/h2>.*?<\/section>/,result.schoolAccess?'$&':'').replace('<!--NIMBUS-CARD-->',result.admin&&result.features?.nimbus!==false?'<section class="card"><h2>Nimbus Search (under construction)</h2><p>Search historical transactions using your Quickbase access.</p><a class="desktop" href="/nimbus">Nimbus Search (under construction) →</a></section>':'').replace('<!--ADMIN-CARD-->',authorizationCard+rctCard+drCard+budgetCard+(result.schoolAccess?'<section class="card"><h2>Settings</h2><p>Manage access and automatic report preferences.</p><a class="desktop" href="/settings">Settings →</a></section>':result.canManage?'<section class="card"><h2>Manage access</h2><p>Manage permissions within the school or units you administer.</p><a class="desktop" href="/admin">Manage access →</a></section>':''))};

};}
export const handler=createDashboardHandler();

