// HTML shells for SoE HQ → Budget: section page, cycle page, unit page. Data comes from budget-hq-data.
import access from './access.cjs';
import navigation from './navigation.cjs';
import units from './units.cjs';
import {parseCycle} from './budget-hq.mjs';

export const CYCLES=['fy28'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const card=(title,description,href,label=title)=>`<section class="card"><h2>${title}</h2><p>${description}</p><a class="desktop" href="${href}">${label} →</a></section>`;
const UNIT=/^(?:[a-z0-9-]{1,40}|x-[a-z0-9-]{1,60})$/;

export function createBudgetHqPageHandler(authorize=access.authorize){return async event=>{
 if(event.httpMethod!=='GET')return {statusCode:405,headers:access.noStore,body:'GET required.'};
 const q=event.queryStringParameters||{},c=q.cycle?parseCycle(q.cycle):null,unit=q.unit?String(q.unit).toLowerCase():null;
 if((q.cycle&&!c)||(unit&&(!c||!UNIT.test(unit))))return {statusCode:404,headers:access.noStore,body:'Page not found.'};
 const path='/soe-hq/budget'+(c?'/'+c.cycle:'')+(unit?'/'+unit:'');
 const result=await authorize(event,{scope:'school'});
 if(result.statusCode===401)return {statusCode:302,headers:{...access.noStore,Location:'/.netlify/functions/auth-login?returnTo='+encodeURIComponent(path)},body:''};
 if(!result.user)return result;
 const fy=c?c.cycle.toUpperCase():'';let title,back,backLabel,body;
 if(!c){
  title='Budget';back='/soe-hq';backLabel='SoE HQ';
  body=CYCLES.map(k=>card(k.toUpperCase()+' budget cycle','Every unit’s requests, HQ decisions (decline or support level, SoE / Provost split), and a page per unit for the Dean’s budget meetings.','/soe-hq/budget/'+k))
   +(result.admin?card('Budget Explorer','Compare what each unit asked for and received across fiscal years, who funded it, and how requests break down.','/soe-hq/budget-explorer')+card('Reserves vs. spending','Months of discretionary reserve by unit, whether it is growing, GIB use and FY requests.','/soe-hq/reserves'):'')
   +card('Budget Submissions','Budget submission materials by fiscal year.','/soe-hq/budget-submissions')
   +(result.admin?card('Budget Explorer (legacy)','The original budget explorer.','/soe-hq/budget-explorer-legacy'):'');
 }else if(!unit){
  title=fy+' budget cycle';back='/soe-hq/budget';backLabel='Budget';
  body=`<div class="bv bh" id="bh" data-view="cycle" data-cycle="${c.cycle}"><p id="bh-loading" class="bv-status">Loading ${fy} requests and decisions…</p><div id="bh-content" hidden></div></div>`;
 }else{
  const u=units.ALL_UNITS[unit];title=(u?u.name:'Unit')+' · '+fy;back='/soe-hq/budget/'+c.cycle;backLabel=fy+' budget cycle';
  body=`<div class="bv bh" id="bh" data-view="unit" data-cycle="${c.cycle}" data-unit="${esc(unit)}"><p id="bh-loading" class="bv-status">Loading ${esc(u?u.label:unit)} for ${fy}…</p><div id="bh-content" hidden></div></div>`;
 }
 const scripts=c?'<link rel="stylesheet" href="/budget-viz.css"><link rel="stylesheet" href="/budget-hq.css"><script type="module" src="/budget-hq.js"></script>':'';
 return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/html; charset=utf-8'},body:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · MITSOEServices</title><link rel="stylesheet" href="/style.css">${scripts}</head><body>${navigation.mainNavigation({manage:result.canManage,schoolAdmin:result.admin,schoolAccess:result.schoolAccess,visibility:result.navigation,active:'hq'})}<main><header><span>SCHOOL OF ENGINEERING</span><span class="badge">MIT sign-in verified</span></header><section class="intro"><a href="${back}">← ${esc(backLabel)}</a><h1>${esc(title)}</h1></section><div class="unit-directory">${body}</div></main></body></html>`};
};}
export const pageHandler=createBudgetHqPageHandler();
