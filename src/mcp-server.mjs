// Read-only MCP server (Streamable HTTP, stateless JSON responses) for the Claude connector.
// Every request is authenticated with a connector token and re-checked against the
// site's access policy (school administrators only). No tool can write to QuickBase.
import {loadBudgetRecords,safeValue,BUDGET_SOURCE_URL} from './budget-explorer.mjs';
import {authenticate} from './mcp-auth.mjs';
import {loadReserves} from './reserves.mjs';

const VERSIONS=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
const AMOUNTS={requested:'Request Amount',dlc_recurring:'Recurring (base) - DLC',dlc_one_time:'Non-recurring (non-base) - DLC',provost_recurring:'Provost Recurring (base) - Approved',provost_one_time:'Provost Non-recurring (non-base) - Approved',soe_approved:'SoE Non-recurring (non-base) - SoE_Approved',declined_initial:'Declined',declined_final:'Declined Final',funder_unresolved:'Historical allocation - funder unresolved'};
const READ_ONLY={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const filterProps={
 fiscal_year:{type:'integer',description:'Budget fiscal year, e.g. 2028 for FY28.'},
 from_year:{type:'integer',description:'First fiscal year to include.'},
 through_year:{type:'integer',description:'Last fiscal year to include.'},
 department:{type:'string',description:'Department/unit name or part of it (case-insensitive), e.g. "EECS", "Aero".'},
 search:{type:'string',description:'Text to find in the original or revised request description or category.'}
};
export const TOOLS=[
 {name:'list_budget_requests',title:'List SoE budget requests',
  description:'Read SoE non-base budget request records from QuickBase (table br8dehttq): fiscal year, department, request descriptions, category, requested amounts, Provost and SoE approvals, declined amounts and status. Read-only. Use filters to narrow results; amounts are in dollars and blank means not recorded.',
  inputSchema:{type:'object',properties:{...filterProps,limit:{type:'integer',minimum:1,maximum:500,default:100},offset:{type:'integer',minimum:0,default:0}},additionalProperties:false},annotations:READ_ONLY},
 {name:'summarize_budget_requests',title:'Summarize SoE budget requests',
  description:'Totals of SoE budget request amounts from QuickBase grouped by fiscal year, department, or both. Amount columns: '+Object.keys(AMOUNTS).join(', ')+'. "recorded" counts records where the amount is filled in. Read-only.',
  inputSchema:{type:'object',properties:{...filterProps,group_by:{type:'string',enum:['fiscal_year','department','both'],default:'fiscal_year'}},additionalProperties:false},annotations:READ_ONLY},
 {name:'unit_reserves',title:'Unit reserves vs. spending',
  description:'For each SoE unit, by fiscal year-end (from verified unit wallet statements): discretionary reserve (department-controlled general expendable funds + GIB carried forward), annual discretionary resources (GIB base + Pool A payout on department general accounts), months of reserve, GIB use rate, restricted department and faculty-controlled balances; plus open QuickBase commitments and the latest budget request. Use to judge which units hold large or growing reserves. Read-only.',
  inputSchema:{type:'object',properties:{group:{type:'string',enum:['academic','all'],default:'academic',description:'academic = academic departments; all = include labs, centers and programs.'},unit:{type:'string',description:'Optional unit label or name filter, e.g. "EECS".'}},additionalProperties:false},annotations:READ_ONLY}
];

function toRows({selected,raw}){return raw.map(r=>{const o={record_id:r['3']?.value??null};for(const f of selected)o[f.label]=safeValue(r[String(f.id)]?.value);return o;});}
const yearOf=r=>{const y=Number.parseInt(r['Budget Fiscal Year'],10);return Number.isFinite(y)?y:null;};
function applyFilters(rows,a){
 const dept=a.department?.trim().toLowerCase(),q=a.search?.trim().toLowerCase();
 return rows.filter(r=>{const y=yearOf(r);
  if(a.fiscal_year!==undefined&&y!==a.fiscal_year)return false;
  if(a.from_year!==undefined&&(y===null||y<a.from_year))return false;
  if(a.through_year!==undefined&&(y===null||y>a.through_year))return false;
  if(dept&&!String(r.Department||'').toLowerCase().includes(dept))return false;
  if(q&&![r['Original Request Description'],r['Revised Request Description'],r['Request Nimbus category']].some(v=>String(v||'').toLowerCase().includes(q)))return false;
  return true;});
}
function check(args,schema){
 if(args===undefined)args={};
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Arguments must be an object.');
 for(const [k,v]of Object.entries(args)){const s=schema.properties[k];if(!s)throw Error('Unknown argument: '+k);
  if(s.type==='integer'&&(!Number.isInteger(v)||(s.minimum!==undefined&&v<s.minimum)||(s.maximum!==undefined&&v>s.maximum)))throw Error(k+' must be a whole number in range.');
  if(s.type==='string'&&(typeof v!=='string'||v.length>200||(s.enum&&!s.enum.includes(v))))throw Error('Invalid '+k+'.');}
 return args;
}
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:(typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null);
export function summarize(rows,groupBy='fiscal_year'){
 const groups=new Map();
 for(const r of rows){const key=groupBy==='department'?[r.Department||'(blank)']:groupBy==='both'?[yearOf(r),r.Department||'(blank)']:[yearOf(r)];const k=JSON.stringify(key);
  if(!groups.has(k)){const g={records:0};if(groupBy!=='department')g.fiscal_year=key[0];if(groupBy!=='fiscal_year')g.department=key[key.length-1];for(const a of Object.keys(AMOUNTS))g[a]={total:0,recorded:0};groups.set(k,g);}
  const g=groups.get(k);g.records++;for(const [a,label]of Object.entries(AMOUNTS)){const v=num(r[label]);if(v!==null){g[a].total+=v;g[a].recorded++;}}}
 return [...groups.values()].sort((x,y)=>(x.fiscal_year??0)-(y.fiscal_year??0)||String(x.department??'').localeCompare(String(y.department??'')));
}

export function createMcpHandler({auth=authenticate,load=loadBudgetRecords,reserves=loadReserves,log=console.log}={}){
 async function callTool(name,args,kerberos){
  const tool=TOOLS.find(t=>t.name===name);if(!tool)return {error:{code:-32602,message:'Unknown tool: '+name}};
  let a;try{a=check(args,tool.inputSchema);}catch(e){return {result:{isError:true,content:[{type:'text',text:e.message}]}};}
  log('Claude connector:',kerberos,'called',name,JSON.stringify(a).slice(0,300));
  if(name==='unit_reserves'){let r;try{r=await reserves({group:a.group||'academic'});}catch(e){console.error('Claude connector reserves error:',e.message);return {result:{isError:true,content:[{type:'text',text:'Reserve data is temporarily unavailable.'}]}};}
   const q=a.unit?.trim().toLowerCase();if(q)r={...r,units:r.units.filter(u=>[u.label,u.name,u.scope].some(v=>String(v).toLowerCase().includes(q)))};
   return {result:{content:[{type:'text',text:JSON.stringify(r)}],structuredContent:r}};}
  let rows;try{rows=applyFilters(toRows(await load()),a);}catch(e){console.error('Claude connector data error:',e.message);return {result:{isError:true,content:[{type:'text',text:'Budget data is temporarily unavailable from QuickBase.'}]}};}
  let data;
  if(name==='list_budget_requests'){const offset=a.offset??0,limit=a.limit??100;data={matched:rows.length,offset,returned:Math.min(limit,Math.max(0,rows.length-offset)),records:rows.slice(offset,offset+limit),source:BUDGET_SOURCE_URL};}
  else data={matched:rows.length,groups:summarize(rows,a.group_by),source:BUDGET_SOURCE_URL};
  return {result:{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}};
 }
 async function rpc(msg,kerberos){
  if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return {jsonrpc:'2.0',id:msg?.id??null,error:{code:-32600,message:'Invalid request'}};
  const isNote=!('id' in msg);if(isNote)return null;
  const ok=result=>({jsonrpc:'2.0',id:msg.id,result}),fail=(code,message)=>({jsonrpc:'2.0',id:msg.id,error:{code,message}});
  switch(msg.method){
   case 'initialize':{const asked=msg.params?.protocolVersion;return ok({protocolVersion:VERSIONS.includes(asked)?asked:VERSIONS[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'mitsoeservices',title:'MIT SoE Services',version:'1.0.0'},instructions:'Read-only access to MIT School of Engineering budget request records and unit reserve figures. Use summarize_budget_requests for totals, list_budget_requests for individual records, and unit_reserves for reserves versus spending by unit.'});}
   case 'ping':return ok({});
   case 'tools/list':return ok({tools:TOOLS});
   case 'tools/call':{const r=await callTool(msg.params?.name,msg.params?.arguments,kerberos);return r.error?fail(r.error.code,r.error.message):ok(r.result);}
   case 'resources/list':return ok({resources:[]});
   case 'prompts/list':return ok({prompts:[]});
   default:return fail(-32601,'Method not found');
  }
 }
 return async request=>{
  if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
  const who=await auth(request);if(who.response)return who.response;
  let body;try{body=await request.json();}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}},{status:400});}
  const batch=Array.isArray(body);if(batch&&!body.length)return Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Empty batch'}},{status:400});
  const out=(await Promise.all((batch?body:[body]).map(m=>rpc(m,who.kerberos)))).filter(Boolean);
  if(!out.length)return new Response(null,{status:202});
  return new Response(JSON.stringify(batch?out:out[0]),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 };
}
