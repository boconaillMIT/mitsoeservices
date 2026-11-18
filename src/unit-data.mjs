import access from './access.cjs';
import units from './units.cjs';
import policy from './policy.cjs';
import {wallet} from './fake-unit.mjs';
export async function readUnit(scope){
 const {getStore}=await import('@netlify/blobs');
 return getStore({name:'mitsoeservices-wallets-'+policy.deploymentName(),consistency:'strong'}).get(scope,{type:'json'});
}
export function validPayload(data,scope){
 const unit=units.WALLETS[scope];
 return !!unit&&data?.schema===1&&data.scope===scope&&data.statement?.unit===unit.source&&data.statement?.status==='Verified'&&Array.isArray(data.rows)&&data.rows.every(r=>String(r.statement_id)===String(data.statement.id)&&r.unit===unit.source&&r.cycle===data.statement.cycle);
}
export function createUnitDataHandler({authorize=access.authorize,read=readUnit}={}){return async event=>{
 if(event.httpMethod!=='GET')return {statusCode:405,headers:access.noStore,body:'GET required'};
 const scope=units.unitScope(event);
 if(!scope)return {statusCode:404,headers:access.noStore,body:'Wallet not found.'};
 const result=await authorize(event,{scope:units.permissionScope(scope)});
 if(!result.user)return result;
 if(units.walletBlocked(scope))return {statusCode:403,headers:access.noStore,body:'Academic unit wallets are currently blocked.'};
 try{
  const data=scope==='soe-fake'?wallet():await read(scope);
  if(!data)return {statusCode:503,headers:access.noStore,body:'Wallet data has not been published yet.'};
  if(!validPayload(data,scope))throw Error('Invalid unit snapshot');
  return {statusCode:200,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(data)};
 }catch{return {statusCode:503,headers:access.noStore,body:'Wallet data is temporarily unavailable.'};}
};}
export const handler=createUnitDataHandler();
