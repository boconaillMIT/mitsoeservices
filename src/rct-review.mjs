import access from './access.cjs';
import navigation from './navigation.cjs';
import {createRctStore} from './rct-store.mjs';
import {dropboxLink,loadDropboxTemplate} from './rct-dropbox.mjs';
import {validateReview} from './rct-model.mjs';
import {exportReviews} from './rct-export.mjs';
const ROOT='/soe-hq/rct-review';
export function createRctHandler({authorize=access.authorize,store=createRctStore(),template=loadDropboxTemplate,exporter=exportReviews}={}){return async event=>{
 const headers={...access.noStore,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'},json=(status,data)=>({statusCode:status,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data)});
 const action=event.path?.startsWith(ROOT)?event.path.slice(ROOT.length).replace(/^\//,''):event.queryStringParameters?.action||'';
 if(!['','data','proposal','source','export'].includes(action))return json(404,{error:'Page not found.'});
 const write=event.httpMethod==='POST'&&action==='data';if(event.httpMethod!=='GET'&&!write)return json(405,{error:'Method not allowed.'});
 const auth=await authorize(event,{scope:'school',minimum:write?'write':'read'});
 if(!auth.user){if(!action&&auth.statusCode===401)return {statusCode:302,headers:{...headers,Location:'/.netlify/functions/auth-login?returnTo='+encodeURIComponent(ROOT)},body:''};return auth;}
 if(write){const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));if(!process.env.APP_ORIGIN||h.origin!==process.env.APP_ORIGIN||h['content-type']?.split(';')[0].trim()!=='application/json')return json(403,{error:'Same-origin JSON required.'});if(typeof event.body!=='string'||event.body.length>70000)return json(413,{error:'Review is too large.'});
  let b,value;try{b=JSON.parse(event.body);if(Object.keys(b).some(k=>!['id','revision','review'].includes(k))||!/^FY27-RCT2\|[a-z-]{1,40}$/.test(b.id||'')||typeof b.revision!=='string'||b.revision.length>100)throw Error('Invalid review.');value=validateReview(b.review);}catch(e){return json(400,{error:e.message||'Invalid review.'});}
  try{const saved=await store.save(b.id,value,b.revision,auth.kerberos);if(saved.conflict)return json(409,{error:'A colleague saved a newer review. Your changes are still on screen. Copy your notes, then reload the saved review before trying again.'});if(saved.missing)return json(404,{error:'Proposal not found.'});return json(200,{row:saved.row});}catch{return json(503,{error:'The review could not be saved. Your changes are still on screen.'});}
 }
 if(!action)return {statusCode:200,headers:{...headers,'Content-Type':'text/html; charset=utf-8'},body:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RCT review · MITSOEServices</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/rct-review.css"><script type="module" src="/rct-review.js"></script></head><body>${navigation.mainNavigation({manage:auth.canManage,schoolAdmin:auth.admin,schoolAccess:auth.schoolAccess,visibility:auth.navigation,active:'rct-review'})}<main class="rct-main"><header><span>SCHOOL OF ENGINEERING</span><span class="badge">MIT sign-in verified</span></header><section class="intro rct-intro"><a href="/soe-hq">SoE HQ</a><div class="rct-title"><div><div class="eyebrow">FY27 · ROUND 2</div><h1>Research continuity &amp; transition</h1><p>Review proposals, agree funding contributions, and download the completed review workbook.</p></div><div class="rct-actions"><a class="desktop" href="/soe-hq/rct-review/source" target="_blank" rel="noopener">Original workbook</a><button id="export" disabled>Download Excel</button></div></div></section><p id="load-status" role="status" aria-live="polite">Loading shared reviews…</p><div id="rct-app" hidden><section id="summary" class="rct-summary" aria-label="Review totals"></section><div class="rct-layout"><section class="card rct-list"><h2>Proposals</h2><label for="search">Find a PI or department</label><input id="search" type="search" placeholder="Search proposals"><label for="filter">Show</label><select id="filter"><option value="all">All proposals</option><option value="incomplete">Needs review or funding</option><option value="complete">Decision and funding complete</option></select><div id="proposal-list"></div></section><section id="detail" class="card rct-detail" aria-label="Selected proposal"></section></div></div></main></body></html>`};
 try{
  const records=await store.list();if(!records.length)return json(503,{error:'No proposals have been imported.'});
  if(action==='data')return json(200,{records,canEdit:auth.canWrite===true});
  if(action==='proposal'){
   const record=records.find(r=>r.id===event.queryStringParameters?.id);if(!record)return json(404,{error:'Proposal not found.'});
   return {statusCode:302,headers:{...headers,Location:dropboxLink(record.source.proposalUrl,'.pdf').toString()},body:''};
  }
  if(action==='source')return {statusCode:302,headers:{...headers,Location:dropboxLink(records[0].source.workbookUrl,'.xlsx').toString()},body:''};
  const sha=records[0].source.templateSha,url=records[0].source.workbookUrl;if(records.some(r=>r.source.templateSha!==sha||r.source.workbookUrl!==url))throw Error('Template versions differ.');
  const bytes=exporter(await template(records[0].source),records);
  return {statusCode:200,headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="FY27_RCT_Round_2_Review_SoE.xlsx"','Content-Length':String(bytes.length)},body:bytes};
 }catch{return json(503,{error:'Shared reviews or documents are unavailable. Please try again.'});}
};}
export const handler=createRctHandler();
