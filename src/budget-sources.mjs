import access from './access.cjs';import {createBudgetSourceStore} from './budget-source-store.mjs';import {normalizeBudgetWorkbook} from './budget-source-model.mjs';import {loadBudgetRecords,safeValue} from './budget-explorer.mjs';import {mapRecord} from '../public/budget-model.mjs';
const ROOT='/soe-hq/budget-sources';
async function canonicalRows(){const {selected,raw}=await loadBudgetRecords();return raw.map(r=>mapRecord(Object.fromEntries(selected.map(f=>[f.label,safeValue(r[String(f.id)]?.value)]))));}
export function createBudgetSourcesHandler({authorize=access.authorize,store=createBudgetSourceStore(),canonical=canonicalRows}={}){return async event=>{
 const h={...access.noStore,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'},reply=(status,data)=>({statusCode:status,headers:{...h,'Content-Type':'application/json'},body:JSON.stringify(data)}),action=event.path?.startsWith(ROOT)?event.path.slice(ROOT.length).replace(/^\//,''):event.queryStringParameters?.action||'';
 if(!['','data','worksheet'].includes(action))return reply(404,{error:'Page not found.'});
 const auth=await authorize(event,{scope:'school',minimum:'admin'});if(!auth.user){if(!action&&auth.statusCode===401)return {statusCode:302,headers:{...h,Location:'/.netlify/functions/auth-login?returnTo='+encodeURIComponent(ROOT)},body:''};return auth;}
 if(event.httpMethod!=='GET')return reply(405,{error:'GET required.'});
 if(!action)return {statusCode:302,headers:{...h,Location:'/soe-hq/budget-explorer'},body:''};
 try{const workbooks=await store.load();if(action==='worksheet'){const q=event.queryStringParameters||{},book=workbooks.find(w=>w.sourceId===q.source),sheet=book?.sheets.find(s=>s.name===q.sheet);if(!sheet)return reply(404,{error:'Worksheet not found.'});return reply(200,{name:book.name,sha:book.sha,sheet});}
  let existing=[],comparisonAvailable=true;try{existing=await canonical();}catch{comparisonAvailable=false;}
  return reply(200,{workbooks:workbooks.map(normalizeBudgetWorkbook),canonical:existing,comparisonAvailable});
 }catch{return reply(503,{error:'Workbook sources could not be safely verified. Please try again.'});}
};}
export const handler=createBudgetSourcesHandler();
