import access from './access.cjs';import units from './units.cjs';import config from './allocations-config.json' with {type:'json'};import {qbRequest} from './nimbus-store.mjs';
export function createAllocationsHandler({authorize=access.authorize,query=qbRequest}={}){return async event=>{
 const reply=(status,data)=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(event.httpMethod!=='GET')return reply(405,{error:'GET required. Allocation data is maintained by SoE administrators.'});
 const q=event.queryStringParameters||{},requested=q.unit||'all',all=requested==='all',scope=units.permissionScope(requested),year=Number(q.year||config.default_year);
 if(!all&&!Object.hasOwn(units.WALLETS,requested))return reply(404,{error:'Unit not found.'});
 const auth=await authorize(event,{scope:all?'school':scope,minimum:all?'admin':'read'});if(!auth.user)return auth;
 if(!Number.isInteger(year)||year<2000||year>2100)return reply(400,{error:'Choose a valid fiscal year.'});
 if(!config.permissions_verified)return reply(503,{error:'Allocations storage permissions have not been verified.'});
 try{
  const f=config.fields,select=[3,2,...Object.values(f)],where=`{${f['Fiscal Year']}.EX.'${year}'}`+(all?'':`AND{${f['Access Scope']}.EX.'${scope}'}`);
  const result=await query('records/query',{from:config.table,select,where,options:{top:1000}});
  if(!Array.isArray(result.data)||result.metadata?.totalRecords!==result.data.length||result.data.length>500)throw Error('Incomplete allocation results.');
  const seen=new Set(),rows=result.data.map(record=>{
   const v=name=>record[String(f[name])]?.value,id=v('Unit Key'),unit=units.WALLETS[id],sourceScope=v('Access Scope'),fy=Number(v('Fiscal Year'));
   if(!unit||sourceScope!==units.permissionScope(id)||!all&&sourceScope!==scope||fy!==year||v('Unit / FY Key')!==id+':'+year||seen.has(id))throw Error('Allocation scope mismatch.');seen.add(id);
   const amount=name=>{const raw=v(name);if(raw===null||raw===undefined||raw==='')return null;if(!['string','number'].includes(typeof raw)||!Number.isFinite(Number(raw))||Math.abs(Number(raw))>1e14)throw Error('Invalid allocation amount.');return Number(raw);};
   const modified=record['2']?.value,updated_at=typeof modified==='string'&&Number.isFinite(Date.parse(modified))?modified:null;
   return {updated_at,unit:id,name:unit.name,year:fy,rewards:amount('Rewards and Recognition'),underrecovery:amount('Underrecovery'),raTuition:amount('RA Tuition Subsidy'),notes:String(v('Notes')||'').slice(0,12000),status:String(v('Allocation Status')||'Pending data').slice(0,100)};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  return reply(200,{scope:requested,year,rows,tableUrl:auth.admin?'https://mit.quickbase.com/db/'+config.table:null});
 }catch{return reply(503,{error:'Allocations could not be verified. No other unit data was substituted.'});}
};}
export const handler=createAllocationsHandler();
